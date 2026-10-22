#!/usr/bin/env bash
# Sets up a hosted Supabase project the way the app needs it, through Supabase's
# Management API. Runs in GitHub Actions after the migrations are pushed; safe to run
# on every deploy (each step sets a value, it never adds a second copy).
#
# Usage: scripts/supabase_project.sh <test|live> <command>
#   setup     API settings, sign-in settings, GraphQL off, the Vault secrets the AI
#             review hook reads, and the server functions' secrets
#   keys      prints SUPABASE_URL=... and SUPABASE_ANON_KEY=... (the public key) for the build
#   advisors  prints Supabase's security advisor findings (never fails the deploy)
#
# Reads: SUPABASE_ACCESS_TOKEN, deploy/<env>.env (SUPABASE_PROJECT_REF), and optionally
#   ANTHROPIC_API_KEY, REVIEW_SECRET, MODERATION_MODEL, APP_ORIGINS, SITE_URL,
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID,
#   TURNSTILE_SECRET_KEY
# Secret values are masked in the GitHub log and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_NAME="${1:?test or live}"
CMD="${2:?setup, keys or advisors}"
REF="$(sed -n 's/^SUPABASE_PROJECT_REF=//p' "deploy/$ENV_NAME.env" | tr -d '[:space:]')"
[ -n "$REF" ] || { echo "deploy/$ENV_NAME.env has no SUPABASE_PROJECT_REF" >&2; exit 1; }
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
API="${SUPABASE_API_BASE:-https://api.supabase.com}/v1/projects/$REF"
mask() { [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$1" ] && echo "::add-mask::$1"; return 0; }

# One Management API call; prints the response body, fails with Supabase's message
api() {
  local method="$1" path="$2" body="${3:-}" out code
  out="$(mktemp)"
  local args=(-sS -o "$out" -w '%{http_code}' -X "$method" "$API$path"
              -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json')
  if [ -n "$body" ]; then args+=(--data "$body"); fi
  for attempt in 1 2 3; do
    code=$(curl "${args[@]}") || code=000
    case "$code" in 2*) cat "$out"; rm -f "$out"; return 0 ;; 429|5*|000) sleep $((attempt * 5)) ;; *) break ;; esac
  done
  echo "Supabase answered $code to $method $path: $(head -c 600 "$out")" >&2
  rm -f "$out"
  return 1
}
sql() { api POST /database/query "$(jq -cn --arg q "$1" '{query: $q}')"; }

keys_json() { api GET '/api-keys?reveal=true'; }
anon_key() { keys_json | jq -r '(map(select(.name == "anon")) + map(select(.type == "publishable")))[0].api_key // empty'; }

case "$CMD" in
keys)
  # Only the two lines go to stdout (the caller masks the key before anything prints it)
  key="$(anon_key)"
  [ -n "$key" ] || { echo "No public (anon or publishable) key found for $REF" >&2; exit 1; }
  echo "SUPABASE_URL=https://$REF.supabase.co"
  echo "SUPABASE_ANON_KEY=$key"
  ;;

advisors)
  out="$(api GET /advisors/security 2>&1)" || { echo "The security advisor isn't available: $out"; exit 0; }
  n=$(jq '[.lints[]? | select(.level == "ERROR" or .level == "WARN")] | length' <<<"$out")
  echo "Supabase security advisor: $n finding(s) to look at"
  jq -r '.lints[]? | select(.level == "ERROR" or .level == "WARN") | "\(.level) \(.name): \(.detail)"' <<<"$out" | while IFS= read -r line; do
    echo "::warning title=Supabase security advisor::$line"
  done
  ;;

setup)
  if [ "$ENV_NAME" = test ]; then default_site=https://community.miraclehealth.us/test/; else default_site=https://community.miraclehealth.us/; fi
  site_url="${SITE_URL:-$default_site}"

  echo "== API: only the public schema, at most 200 rows a request (GraphQL isn't exposed)"
  api PATCH /postgrest '{"db_schema":"public","db_extra_search_path":"public,extensions","max_rows":200}' >/dev/null
  # The app doesn't use GraphQL; the live project runs without it (CI tests the same)
  sql 'drop extension if exists pg_graphql cascade' >/dev/null 2>&1 \
    || echo "::warning title=GraphQL::Couldn't turn pg_graphql off from here. Turn it off in Supabase: Database > Extensions > pg_graphql."

  echo "== Sign-in: phone codes only, no email sign-up, no anonymous users"
  auth="$(jq -cn --arg site "$site_url" '{
      site_url: $site, disable_signup: false,
      external_email_enabled: false, external_anonymous_users_enabled: false,
      external_phone_enabled: true, sms_autoconfirm: false, sms_max_frequency: 60,
      sms_template: "Your Miracle Health code is {{ .Code }}",
      jwt_exp: 3600, refresh_token_rotation_enabled: true }')"
  if [ -n "${TWILIO_ACCOUNT_SID:-}" ] && [ -n "${TWILIO_AUTH_TOKEN:-}" ] && [ -n "${TWILIO_VERIFY_SERVICE_SID:-}" ]; then
    mask "$TWILIO_AUTH_TOKEN"
    auth="$(jq -c --arg a "$TWILIO_ACCOUNT_SID" --arg t "$TWILIO_AUTH_TOKEN" --arg s "$TWILIO_VERIFY_SERVICE_SID" \
      '. + {sms_provider: "twilio_verify", sms_twilio_verify_account_sid: $a, sms_twilio_verify_auth_token: $t, sms_twilio_verify_message_service_sid: $s}' <<<"$auth")"
    echo "   texts go out through Twilio Verify"
  elif [ "$ENV_NAME" = test ]; then
    # No text provider yet: only the test numbers below can sign in (no texts are sent to them)
    auth="$(jq -c '. + {sms_provider: "twilio", sms_twilio_account_sid: "AC00000000000000000000000000000000",
      sms_twilio_auth_token: "00000000000000000000000000000000", sms_twilio_message_service_sid: "MG00000000000000000000000000000000"}' <<<"$auth")"
    echo "   no text provider yet: only the test numbers can sign in"
  else
    echo "The live project needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID" >&2
    exit 1
  fi
  if [ "$ENV_NAME" = test ]; then
    # Test numbers for the test app (the same ones the local tests use), code 123456
    auth="$(jq -c '. + {sms_test_otp: "15555550101=123456,15555550102=123456,15555550103=123456,15555550104=123456",
      sms_test_otp_valid_until: "2027-12-31T23:59:59Z"}' <<<"$auth")"
  fi
  if [ -n "${TURNSTILE_SECRET_KEY:-}" ]; then
    mask "$TURNSTILE_SECRET_KEY"
    auth="$(jq -c --arg k "$TURNSTILE_SECRET_KEY" '. + {security_captcha_enabled: true, security_captcha_provider: "turnstile", security_captcha_secret: $k}' <<<"$auth")"
  else
    auth="$(jq -c '. + {security_captcha_enabled: false}' <<<"$auth")"
  fi
  api PATCH /config/auth "$auth" >/dev/null

  echo "== Vault: where the database sends new posts for Miracle AI's read, and the shared secret"
  sql "do \$\$ declare v uuid; begin
         select id into v from vault.secrets where name = 'project_url';
         if v is null then perform vault.create_secret('https://$REF.supabase.co', 'project_url');
         else perform vault.update_secret(v, 'https://$REF.supabase.co'); end if;
       end \$\$" >/dev/null
  secret="${REVIEW_SECRET:-}"
  if [ -n "$secret" ]; then
    mask "$secret"
    q="${secret//\'/\'\'}"   # quotes doubled for SQL
    sql "do \$\$ declare v uuid; begin
           select id into v from vault.secrets where name = 'review_secret';
           if v is null then perform vault.create_secret('$q', 'review_secret');
           else perform vault.update_secret(v, '$q'); end if;
         end \$\$" >/dev/null
  else
    # No REVIEW_SECRET in GitHub: make one in the Vault once, and keep using it
    sql "do \$\$ begin
           if not exists (select 1 from vault.secrets where name = 'review_secret') then
             perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'review_secret');
           end if;
         end \$\$" >/dev/null
    secret="$(sql "select decrypted_secret as s from vault.decrypted_secrets where name = 'review_secret'" | jq -r '.[0].s // empty')"
    mask "$secret"
    [ -n "$secret" ] || { echo "Couldn't read the review secret back from the Vault" >&2; exit 1; }
  fi

  echo "== Server functions' settings"
  args=("REVIEW_SECRET=$secret" "MODERATION_MODEL=${MODERATION_MODEL:-claude-haiku-5-5}"
        "APP_ORIGINS=${APP_ORIGINS:-https://community.miraclehealth.us}")
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    mask "$ANTHROPIC_API_KEY"
    args+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
  else
    echo "::warning title=Miracle AI::ANTHROPIC_API_KEY isn't set, so Miracle AI won't read posts and reports won't count toward the Signal."
  fi
  supabase secrets set --project-ref "$REF" "${args[@]}" >/dev/null
  echo "done"
  ;;
*)
  echo "unknown command $CMD" >&2; exit 2 ;;
esac
