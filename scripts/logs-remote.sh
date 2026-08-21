#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_env

target="${1:-server}"
lines="${2:-100}"
deploy_target="${PHONEWEAVE_DEPLOY_TARGET:-}"
[[ -n "$deploy_target" ]] || { echo "[PhoneWeave] PHONEWEAVE_DEPLOY_TARGET is not set in .env" >&2; exit 1; }

echo "[PhoneWeave] Connecting to remote server ($deploy_target) for logs..."

case "$target" in
  actions|action)
    echo "[PhoneWeave] Streaming Action/Click/Gesture logs from phoneweave-control-server (tail: $lines)..."
    ssh -t "$deploy_target" "docker logs -f --tail $lines phoneweave-control-server 2>&1 | grep --line-buffered -E '\[Action|\[Human|\[Device'"
    ;;
  turn)
    echo "[PhoneWeave] Streaming logs for phoneweave-turn (tail: $lines)..."
    ssh -t "$deploy_target" "docker logs -f --tail $lines phoneweave-turn"
    ;;
  all)
    echo "[PhoneWeave] Streaming logs for all PhoneWeave containers (tail: $lines)..."
    ssh -t "$deploy_target" "docker logs -f --tail $lines phoneweave-control-server & docker logs -f --tail $lines phoneweave-turn & wait"
    ;;
  server|*)
    echo "[PhoneWeave] Streaming logs for phoneweave-control-server (tail: $lines)..."
    ssh -t "$deploy_target" "docker logs -f --tail $lines phoneweave-control-server"
    ;;
esac
