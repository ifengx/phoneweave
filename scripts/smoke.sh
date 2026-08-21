#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
for f in "$ROOT"/server/src/*.mjs "$ROOT"/server/test/*.mjs "$ROOT"/mcp/index.mjs; do
  node --check "$f"
done
for f in "$ROOT"/phoneweave "$ROOT"/scripts/*.sh; do
  bash -n "$f"
done
node --test "$ROOT"/server/test/*.test.mjs
npm --prefix "$ROOT/web-console" run build
echo "[PhoneWeave] smoke checks passed"
