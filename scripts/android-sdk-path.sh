#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
source "$ROOT/scripts/android-env.sh"
sdk="$(phoneweave_configure_android_env)"
echo "[PhoneWeave] Android SDK: $sdk"
echo "[PhoneWeave] adb: $(command -v adb || true)"
echo "[PhoneWeave] emulator: $(command -v emulator || true)"
echo "[PhoneWeave] local.properties: $ROOT/android-agent/local.properties"
