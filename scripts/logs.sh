#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
exec docker compose logs -f --tail=200
