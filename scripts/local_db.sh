#!/usr/bin/env bash
# A local database for the tests, without Docker: plain Postgres 16 set up to
# behave like a Supabase project (scripts/local_db/supabase_shim.sql).
# Usage: scripts/local_db.sh up | reset | test | lint | down
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${PGDATA_DIR:-$PWD/.pgdata}
PORT=${PGPORT:-54322}
RUN_AS=${PG_RUN_AS:-postgres}   # Postgres won't run as root
DB=app
URL="postgresql://postgres@127.0.0.1:$PORT/$DB"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u "$RUN_AS" -- "$@"; else "$@"; fi; }
case "${1:-}" in
  up)
    if [ ! -s "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"; if [ "$(id -u)" = 0 ]; then chown "$RUN_AS" "$DATA"; fi
      as_pg "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
    fi
    as_pg "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=127.0.0.1" -l "$DATA/server.log" -w start >/dev/null 2>&1 || true
    as_pg "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" ;;
  reset)
    psql "postgresql://postgres@127.0.0.1:$PORT/postgres" -q -c "drop database if exists $DB with (force)" -c "create database $DB"
    psql "$URL" -q -v ON_ERROR_STOP=1 -f scripts/local_db/supabase_shim.sql
    for f in supabase/migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
    for f in supabase/seed.sql supabase/seed_ask.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
    echo "database $DB rebuilt from the migrations" ;;
  test)
    status=0
    for f in supabase/tests/database/*.test.sql; do
      echo "# $f"
      out=$(psql "$URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$f" 2>&1) || status=1
      echo "$out" | grep -v '^$'
      if echo "$out" | grep -q '^not ok'; then status=1; fi
    done
    exit $status ;;
  lint)
    scripts/security_lints.sh "$URL" "${SPLINTER_SQL:-}" ;;
  down)
    as_pg "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  *) echo "usage: $0 up|reset|test|lint|down"; exit 2 ;;
esac
