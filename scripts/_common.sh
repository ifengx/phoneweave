#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
load_env() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
  fi
}
configure_android_env() {
  # shellcheck disable=SC1091
  source "$ROOT/scripts/android-env.sh"
  phoneweave_configure_android_env
}
