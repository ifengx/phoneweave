#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_env
version_file="$ROOT/agent-version.properties"
[[ -f "$version_file" ]] || { echo "Missing $version_file" >&2; exit 1; }
# shellcheck disable=SC1090
source "$version_file"
[[ "${PHONEWEAVE_AGENT_VERSION_NAME:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([._-][a-zA-Z0-9.-]+)?$ ]] || { echo "Invalid PHONEWEAVE_AGENT_VERSION_NAME" >&2; exit 1; }
[[ "${PHONEWEAVE_AGENT_VERSION_CODE:-}" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid PHONEWEAVE_AGENT_VERSION_CODE" >&2; exit 1; }
SDK="$(configure_android_env)"
[[ -d "$SDK/platforms/android-36" ]] || echo "Warning: Android SDK platform 36 was not found under $SDK/platforms/android-36"
cd "$ROOT/android-agent"
server_ip="${PHONEWEAVE_SERVER_IP:-10.0.2.2}"
control_port="${PORT:-8787}"
default_server_url="${PHONEWEAVE_ANDROID_SERVER_URL:-http://$server_ip:$control_port}"
"$ROOT/scripts/gradle.sh" --no-daemon \
  -PphoneweaveDefaultServerUrl="$default_server_url" \
  :app:assembleDebug
APK="$ROOT/android-agent/app/build/outputs/apk/debug/app-debug.apk"
VERSIONED_APK="$ROOT/android-agent/app/build/outputs/apk/debug/phoneweave-agent-${PHONEWEAVE_AGENT_VERSION_NAME}-${PHONEWEAVE_AGENT_VERSION_CODE}-debug.apk"
cp -f "$APK" "$VERSIONED_APK"
echo "[PhoneWeave] APK version: $PHONEWEAVE_AGENT_VERSION_NAME ($PHONEWEAVE_AGENT_VERSION_CODE)"
echo "[PhoneWeave] APK: $VERSIONED_APK"
echo "[PhoneWeave] Gradle APK: $APK"
echo "[PhoneWeave] Default server: $default_server_url"
