#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
configure_android_env

target_mode="${1:-agent}"
shift || true

# Check if adb is available
if ! command -v adb >/dev/null 2>&1; then
  echo "[PhoneWeave] adb command not found. Please ensure Android SDK platform-tools is in PATH." >&2
  exit 1
fi

# Detect device
devices="$(adb devices | grep -v "List of devices" | grep -w "device" | awk '{print $1}')"
if [[ -z "$devices" ]]; then
  echo "[PhoneWeave] No connected Android device or emulator found." >&2
  echo "[PhoneWeave] Run './phoneweave emulator-start' or connect a phone with USB debugging enabled." >&2
  exit 1
fi

device_count="$(echo "$devices" | wc -l | tr -d ' ')"
serial="${ANDROID_SERIAL:-}"
if [[ -z "$serial" ]]; then
  if [[ "$device_count" -eq 1 ]]; then
    serial="$(echo "$devices" | head -1)"
  else
    serial="$(echo "$devices" | head -1)"
    echo "[PhoneWeave] Multiple devices found. Defaulting to $serial (set ANDROID_SERIAL to override)." >&2
  fi
fi

echo "[PhoneWeave] Streaming Android logs from device: $serial (mode: $target_mode)"
echo "[PhoneWeave] Press Ctrl+C to stop..."
echo ""

case "$target_mode" in
  crash|errors)
    exec adb -s "$serial" logcat -b crash -b main -v time *:E | grep -iE "phoneweave|AndroidRuntime|FATAL|AgentSocket"
    ;;
  all|full)
    exec adb -s "$serial" logcat -v time "$@"
    ;;
  agent|*)
    # Filter by PhoneWeave tags and package PID
    exec adb -s "$serial" logcat -v time -s PhoneWeave:V AgentSocket:V ControlEngine:V WebRtcScreenEngine:V AndroidRuntime:E \
      | grep --line-buffered -iE "phoneweave|AgentSocket|ControlEngine|WebRtcScreenEngine|AndroidRuntime"
    ;;
esac
