#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
[[ -d "$ROOT/web-console/node_modules" ]] || "$ROOT/scripts/bootstrap.sh"
npm --prefix "$ROOT/web-console" run build
echo "[PhoneWeave] Web console built: $ROOT/web-console/dist"
