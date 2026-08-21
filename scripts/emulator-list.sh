#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
source "$ROOT/scripts/android-env.sh"
phoneweave_configure_android_env >/dev/null
command -v emulator >/dev/null || { echo "Android Emulator binary not found under $ANDROID_HOME/emulator" >&2; exit 1; }
echo "[PhoneWeave] Available Android Virtual Devices:"
emulator -list-avds
