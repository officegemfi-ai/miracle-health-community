#!/usr/bin/env bash
# Sets up a hosted Supabase project the way the app needs it, through Supabase's
# Management API. Runs in GitHub Actions; safe to run on every deploy (each step sets a
# value, it never adds a second copy).
#
# Usage: scripts/supabase_project.sh <test|live> <command>
#   ref       prints the project ref: from deploy/<env>.env, or else the project the token
#             reaches that's named miracle-health-<env>
#   create    live only: prints the live project's ref, creating the project first if it
#             doesn't exist yet (same organization and region as the test project). On
#             creation it also writes the new database password to $GITHUB_ENV (masked)
#             so the same job can link to it; later runs link without a password.
#   setup     API settings, sign-in settings, GraphQL off, the Vault secrets the AI
#             review hook reads, and the server functions' secrets
#   founding  live only: the founder's one-time invite (FOUNDING_INVITE), and once the
#             founder has signed up with it, makes that account the admin
#   keys      prints SUPABASE_URL=... and SUPABASE_ANON_KEY=... (the public key) for the build
#   advisors  prints Supabase's security advisor findings (never fails the deploy)
#
# Reads: SUPABASE_ACCESS_TOKEN, deploy/<env>.env (SUPABASE_PROJECT_REF), and optionally
#   ANTHROPIC_API_KEY, REVIEW_SECRET, MODERATION_MODEL, APP_ORIGINS, SITE_URL,
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID,
#   TURNSTILE_SECRET_KEY, FOUNDING_INVITE
# Secret values are masked in the GitHub log and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_NAME="${1:?test or live}"
CMD="${2:?ref, create, setup, founding, keys or advisors}"
case "$ENV_NAME" in test|live) ;; *) echo "The environment is test or live, not $ENV_NAME" >&2; exit 2 ;; esac
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
BASE="${SUPABASE_API_BASE:-https://api.supabase.com}"
NAME="miracle-health-$ENV_NAME"
# GitHub reads workflow commands from both output streams; stderr keeps them out of
# anything a caller captures (like the ref that "create" prints)
mask() { [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$1" ] && echo "::add-mask::$1" >&2; return 0; }

# One Management API call (path from /v1); prints the response body, fails with Supabase's message
call() {
  local method="$1" path="$2" body="${3:-}" out code
  out="$(mktemp)"
  local args=(-sS -o "$out" -w '%{http_code}' -X "$method" "$BASE$path"
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

# The project: written down in deploy/<env>.env, or the one the token reaches by its name.
# (Never "whichever project there is": that could be the other environment's.)
env_ref() { [ -f "deploy/$1.env" ] && sed -n 's/^SUPABASE_PROJECT_REF=//p' "deploy/$1.env" | tr -d '[:space:]'; return 0; }
REF="$(env_ref "$ENV_NAME")"
if [ -z "$REF" ]; then
  projects="$(call GET /v1/projects)" || exit 1
  REF="$(jq -r --arg n "$NAME" 'if type == "array" then (map(select(.name == $n)) | if length == 1 then .[0].id else empty end) else empty end' <<<"$projects" 2>/dev/null || true)"
fi
if [ -z "$REF" ] && [ "$CMD" != create ]; then
  echo "Couldn't find the $ENV_NAME project: deploy/$ENV_NAME.env names none, and no project the token reaches is called $NAME." >&2
  exit 1
fi

api() { call "$1" "/v1/projects/$REF$2" "${3:-}"; }
sql() { api POST /database/query "$(jq -cn --arg q "$1" '{query: $q}')"; }
keys_json() { api GET '/api-keys?reveal=true'; }
anon_key() { keys_json | jq -r '(map(select(.name == "anon")) + map(select(.type == "publishable")))[0].api_key // empty'; }

# Waits until the project and its database, API and sign-in services are up
wait_healthy() {
  local i st health
  for i in $(seq 1 90); do
    st="$(api GET '' 2>/dev/null | jq -r '.status // empty' || true)"
    if [ "$st" = ACTIVE_HEALTHY ]; then
      health="$(api GET '/health?services=auth&services=db&services=rest' 2>/dev/null || echo '[]')"
      if jq -e 'type == "array" and length > 0 and all(.status == "ACTIVE_HEALTHY")' <<<"$health" >/dev/null 2>&1; then return 0; fi
    fi
    sleep 10
  done
  echo "The $ENV_NAME project $REF wasn't up after 15 minutes (status: ${st:-unknown})" >&2
  return 1
}

case "$CMD" in
ref)
  echo "$REF"
  ;;

create)
  [ "$ENV_NAME" = live ] || { echo "create is only for the live project" >&2; exit 2; }
  if [ -n "$REF" ]; then
    wait_healthy >&2
    echo "$REF"
    exit 0
  fi
  # A new project, next to the test one: same organization, same region
  projects="${projects:-$(call GET /v1/projects)}"
  test_ref="$(env_ref test)"
  pick() { jq -r --arg r "$test_ref" --arg f "$1" '[.[] | select(.id == $r or .name == "miracle-health-test")][0][$f] // empty' <<<"$projects"; }
  org_id="$(pick organization_id)"; org_slug="$(pick organization_slug)"; region="$(pick region)"
  if [ -z "$org_id$org_slug" ]; then
    org_id="$(jq -r 'map(.organization_id) | unique | if length == 1 then .[0] else empty end' <<<"$projects")"
  fi
  [ -n "$org_id$org_slug" ] || { echo "Couldn't tell which Supabase organization the live project belongs in." >&2; exit 1; }
  region="${region:-us-east-1}"
  pass="Mh$(openssl rand -hex 20)Z9"
  mask "$pass"
  by_name() { call GET /v1/projects | jq -r --arg n "$NAME" 'map(select(.name == $n))[0].id // empty'; }
  echo "Creating the Supabase project $NAME in ${region}..." >&2
  # The current request format first, then the older one
  if ! created="$(call POST /v1/projects "$(jq -cn --arg n "$NAME" --arg o "${org_slug:-$org_id}" --arg r "$region" --arg p "$pass" \
      '{name: $n, organization_slug: $o, db_pass: $p, region_selection: {type: "specific", code: $r}}')" 2>/dev/null)"; then
    created=""
    # Only try again if the first request really didn't make one
    if [ -z "$(by_name)" ]; then
      created="$(call POST /v1/projects "$(jq -cn --arg n "$NAME" --arg o "${org_id:-$org_slug}" --arg r "$region" --arg p "$pass" \
        '{name: $n, organization_id: $o, db_pass: $p, region: $r}')")" \
        || { echo "Supabase didn't create the live project. Its free plan allows two active projects per organization: if there are already two, upgrade the organization or pause one." >&2; exit 1; }
    fi
  fi
  REF="$(jq -r '.id // .ref // empty' <<<"${created:-null}")"
  [ -n "$REF" ] || REF="$(by_name)"
  [ -n "$REF" ] || { echo "Supabase created a project but didn't say its ref: $(head -c 300 <<<"$created")" >&2; exit 1; }
  if [ -n "${GITHUB_ENV:-}" ]; then echo "SUPABASE_DB_PASSWORD=$pass" >> "$GITHUB_ENV"; fi
  wait_healthy >&2
  echo "$REF"
  ;;

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
  if [ "$ENV_NAME" = test ]; then
    default_site=https://community.miraclehealth.us/test/
    # The deploy's end-to-end check runs the test app from the runner itself, at this address
    default_origins=https://community.miraclehealth.us,http://127.0.0.1:4173
  else
    default_site=https://community.miraclehealth.us/
    default_origins=https://community.miraclehealth.us
  fi
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
  if [ "$ENV_NAME" = live ]; then
    # Live must never have phone numbers that sign in with a fixed code
    otp="$(api GET /config/auth | jq -r '.sms_test_otp // empty')"
    if [ -n "$otp" ]; then
      echo "::error title=Sign-in::The live project has test phone numbers with a fixed code. Remove them in Supabase: Authentication > Sign In / Providers > Phone > Test phone numbers."
      exit 1
    fi
  fi

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
  origins="${APP_ORIGINS:-$default_origins}"
  if [ "$ENV_NAME" = test ]; then
    case ",$origins," in *,http://127.0.0.1:4173,*) ;; *) origins="$origins,http://127.0.0.1:4173" ;; esac
  fi
  args=("REVIEW_SECRET=$secret" "MODERATION_MODEL=${MODERATION_MODEL:-claude-haiku-5-5}" "APP_ORIGINS=$origins")
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    mask "$ANTHROPIC_API_KEY"
    args+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
  else
    echo "::warning title=Miracle AI::ANTHROPIC_API_KEY isn't set, so Miracle AI won't read posts and reports won't count toward the Signal."
  fi
  supabase secrets set --project-ref "$REF" "${args[@]}" >/dev/null
  echo "done"
  ;;

founding)
  [ "$ENV_NAME" = live ] || { echo "founding is only for the live project" >&2; exit 2; }
  code="$(printf '%s' "${FOUNDING_INVITE:-}" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
  if [ -z "$code" ]; then
    echo "::notice title=Founder::No FOUNDING_INVITE secret, so no founder invite was made. Add one (6 to 40 letters and numbers) and run this again."
    exit 0
  fi
  mask "$code"
  if ! [[ "$code" =~ ^[A-Z0-9]{6,40}$ ]]; then
    echo "::error title=Founder::FOUNDING_INVITE must be 6 to 40 letters and numbers, with no dashes or spaces."
    exit 1
  fi
  # One use, trusted (no first-week limits); kept if it already exists
  sql "insert into public.invites (code, note, trusted, max_uses) values ('$code', 'Founder', true, 1)
       on conflict (code) do nothing" >/dev/null
  made="$(sql "update public.profiles set role = 'admin' where invite_code = '$code' and role <> 'admin' returning handle" | jq -r '.[0].handle // empty')"
  who="$(sql "select handle from public.profiles where invite_code = '$code'" | jq -r '.[0].handle // empty')"
  if [ -n "$made" ]; then echo "::notice title=Founder::u/$made signed up with the founding invite and is now the admin."
  elif [ -n "$who" ]; then echo "u/$who is the admin."
  else echo "::notice title=Founder::The founding invite is ready. Sign up with it, then run this workflow again to become the admin."
  fi
  ;;

*)
  echo "unknown command $CMD" >&2; exit 2 ;;
esac
