#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
source "$ROOT/scripts/android-env.sh"
phoneweave_configure_android_env >/dev/null

if ! adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {found=1} END{exit !found}'; then
  "$ROOT/scripts/emulator-start.sh" "${1:-}"
fi

serial="$(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1; exit}')"
[[ -n "$serial" ]] || { echo "No running Android emulator found" >&2; exit 1; }

"$ROOT/scripts/build-android.sh"
ANDROID_SERIAL="$serial" "$ROOT/scripts/install-android.sh"

echo
cat <<MSG
[PhoneWeave] Emulator development wiring
  Emulator: $serial
  Agent Server URL: http://10.0.2.2:${PORT:-8787}
  Device token: ${PHONEWEAVE_DEVICE_TOKEN:-change-me-device}

In the PhoneWeave Agent app:
  1. Keep Server URL = http://10.0.2.2:${PORT:-8787}
  2. Keep/enter Device token above
  3. Enable Accessibility
  4. Start Agent

Then open on your Mac:
  http://localhost:${PORT:-8787}
MSG
