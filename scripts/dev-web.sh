#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
[[ -d "$ROOT/web-console/node_modules" ]] || "$ROOT/scripts/bootstrap.sh"
exec npm --prefix "$ROOT/web-console" run dev
