#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
configure_android_env >/dev/null
command -v adb >/dev/null || { echo "adb is required" >&2; exit 1; }
APK="$ROOT/android-agent/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$APK" ]] || "$ROOT/scripts/build-android.sh"
serial="${ANDROID_SERIAL:-}"
if [[ -n "$serial" ]]; then
  adb -s "$serial" install -r "$APK"
  adb -s "$serial" shell am start -n io.phoneweave.agent/.ui.MainActivity
else
  adb install -r "$APK"
  adb shell am start -n io.phoneweave.agent/.ui.MainActivity
fi
