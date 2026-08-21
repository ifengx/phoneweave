#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
command -v docker >/dev/null || { echo "Docker is required for ./phoneweave up. Use ./phoneweave dev without Docker." >&2; exit 1; }
[[ -f "$ROOT/.env" ]] || cp "$ROOT/.env.example" "$ROOT/.env"
cd "$ROOT"
exec docker compose up -d --build
