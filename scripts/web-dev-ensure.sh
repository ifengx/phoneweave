#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PHONEWEAVE_WEB_PORT:-5173}"
URL="http://127.0.0.1:${PORT}/"
LOG="$ROOT/.tools/vite.log"
PIDFILE="$ROOT/.tools/vite.pid"

mkdir -p "$ROOT/.tools"

if curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
  echo "[PhoneWeave] Vite already ready: $URL"
  exit 0
fi

if [[ ! -d "$ROOT/web-console/node_modules" ]]; then
  echo "[PhoneWeave] Web dependencies missing; running bootstrap..."
  "$ROOT/scripts/bootstrap.sh"
fi

# Remove a stale pid file if present.
if [[ -f "$PIDFILE" ]]; then
  old_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && ! kill -0 "$old_pid" >/dev/null 2>&1; then
    rm -f "$PIDFILE"
  fi
fi

if [[ ! -f "$PIDFILE" ]]; then
  echo "[PhoneWeave] Starting Vite dev server on $URL"
  (
    cd "$ROOT/web-console"
    nohup npm run dev -- --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
  )
fi

for _ in $(seq 1 80); do
  if curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
    echo "[PhoneWeave] Vite ready: $URL"
    exit 0
  fi
  sleep 0.25
done

echo "[PhoneWeave] Vite failed to become ready. Last log lines:" >&2
tail -n 80 "$LOG" >&2 || true
exit 1
