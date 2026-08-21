#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
command -v node >/dev/null || { echo "Node.js 20+ is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( major >= 20 )) || { echo "Node.js 20+ is required; found $(node -v)" >&2; exit 1; }
[[ -f "$ROOT/.env" ]] || cp "$ROOT/.env.example" "$ROOT/.env"
echo "[PhoneWeave] installing server dependencies..."
npm --prefix "$ROOT/server" install
echo "[PhoneWeave] installing MCP dependencies..."
npm --prefix "$ROOT/mcp" install
echo "[PhoneWeave] installing Web Console dependencies..."
npm --prefix "$ROOT/web-console" install
echo "[PhoneWeave] bootstrap complete. Edit $ROOT/.env before production use."
