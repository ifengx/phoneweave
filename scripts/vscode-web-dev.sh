#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PHONEWEAVE_WEB_PORT:-5173}"
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}/"

mkdir -p "$ROOT/.tools"

if [[ ! -d "$ROOT/web-console/node_modules" ]]; then
  echo "[PhoneWeave] Web dependencies missing; running bootstrap..."
  "$ROOT/scripts/bootstrap.sh"
fi

echo "[PhoneWeave] WEB_DEV_STARTING $URL"

# If a Vite server is already running, keep this background task alive while it is reachable.
if curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
  echo "[PhoneWeave] WEB_DEV_READY $URL"
  while curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; do
    sleep 1
  done
  exit 0
fi

cd "$ROOT/web-console"

# Keep Vite as a child of this VS Code background task. Do not detach it with nohup:
# VS Code can otherwise reap the detached child when the preLaunch task exits.
npm run dev -- --host "$HOST" --port "$PORT" &
VITE_PID=$!

cleanup() {
  if kill -0 "$VITE_PID" >/dev/null 2>&1; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 120); do
  if curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
    echo "[PhoneWeave] WEB_DEV_READY $URL"
    wait "$VITE_PID"
    exit $?
  fi

  if ! kill -0 "$VITE_PID" >/dev/null 2>&1; then
    echo "[PhoneWeave] Vite exited before becoming ready." >&2
    wait "$VITE_PID" || true
    exit 1
  fi

  sleep 0.25
done

echo "[PhoneWeave] Timed out waiting for Vite at $URL" >&2
exit 1
