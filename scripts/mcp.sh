#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_env
export PHONEWEAVE_BASE_URL="${PHONEWEAVE_BASE_URL:-${PUBLIC_BASE_URL:-http://localhost:${PORT:-8787}}}"
[[ -d "$ROOT/mcp/node_modules" ]] || npm --prefix "$ROOT/mcp" install
exec node "$ROOT/mcp/index.mjs"
