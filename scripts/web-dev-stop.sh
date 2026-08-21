#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.tools/vite.pid"
if [[ ! -f "$PIDFILE" ]]; then
  echo "[PhoneWeave] No managed Vite process found."
  exit 0
fi
pid="$(cat "$PIDFILE" 2>/dev/null || true)"
if [[ -n "${pid:-}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
  kill "$pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
fi
rm -f "$PIDFILE"
echo "[PhoneWeave] Managed Vite dev server stopped."
