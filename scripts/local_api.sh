#!/usr/bin/env bash
# Starts or stops the local API stand-in (scripts/local-api/server.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE=${PIDFILE:-.pgdata.api.pid}
case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running"; exit 0; fi
    DATABASE_URL=${DATABASE_URL:-postgresql://postgres@127.0.0.1:54322/app} nohup node scripts/local-api/server.mjs > "${LOG:-/dev/null}" 2>&1 &
    echo $! > "$PIDFILE"; sleep 1; echo "local api running (pid $(cat "$PIDFILE"))" ;;
  stop)
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; echo stopped ;;
esac
