#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
source "$ROOT/scripts/android-env.sh"
phoneweave_configure_android_env >/dev/null
command -v emulator >/dev/null || { echo "Android Emulator binary not found" >&2; exit 1; }
command -v adb >/dev/null || { echo "adb not found" >&2; exit 1; }

avd="${1:-${PHONEWEAVE_AVD:-}}"
if [[ -z "$avd" ]]; then
  avd="$(emulator -list-avds | head -1 || true)"
fi
if [[ -z "$avd" ]]; then
  cat >&2 <<'MSG'
[PhoneWeave] No Android Virtual Device exists.
Create one first in Android Studio > Device Manager > Create Virtual Device.
A Pixel device with a recent Android/API image is a good development baseline.
MSG
  exit 1
fi

# Do not start another emulator if one is already connected unless explicitly requested.
if adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {found=1} END{exit !found}'; then
  existing="$(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1; exit}')"
  echo "[PhoneWeave] Emulator already running: $existing"
  exit 0
fi

echo "[PhoneWeave] Starting AVD: $avd"
mkdir -p "$ROOT/.tools"
nohup emulator -avd "$avd" -no-snapshot-save >"$ROOT/.tools/emulator.log" 2>&1 &

echo "[PhoneWeave] Waiting for emulator..."
adb wait-for-device
serial="$(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1; exit}')"
[[ -n "$serial" ]] || { echo "Emulator did not become visible to adb" >&2; exit 1; }

# Wait for Android framework boot completion.
for _ in $(seq 1 120); do
  boot="$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  [[ "$boot" == "1" ]] && break
  sleep 1
done

echo "[PhoneWeave] Emulator ready: $serial"
echo "[PhoneWeave] Log: $ROOT/.tools/emulator.log"
