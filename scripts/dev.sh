#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_env
if [[ -f "$ROOT/agent-version.properties" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/agent-version.properties"
  set +a
fi
[[ -d "$ROOT/server/node_modules" ]] || "$ROOT/scripts/bootstrap.sh"
exec node "$ROOT/server/src/server.mjs"
