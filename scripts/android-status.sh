#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
configure_android_env

action="${1:-status}"
shift || true

if ! command -v adb >/dev/null 2>&1; then
  echo "[PhoneWeave] adb command not found." >&2
  exit 1
fi

devices="$(adb devices | grep -v "List of devices" | grep -w "device" | awk '{print $1}')"
if [[ -z "$devices" ]]; then
  echo "[PhoneWeave] No connected Android device found." >&2
  exit 1
fi

serial="${ANDROID_SERIAL:-$(echo "$devices" | head -1)}"

case "$action" in
  screenshot)
    output_file="${1:-$ROOT/screenshot-$(date +%Y%m%d_%H%M%S).png}"
    echo "[PhoneWeave] Capturing screenshot from $serial..."
    adb -s "$serial" exec-out screencap -p > "$output_file"
    echo "[PhoneWeave] Screenshot saved to: $output_file"
    ;;
  restart)
    echo "[PhoneWeave] Restarting PhoneWeave Agent on $serial..."
    adb -s "$serial" shell am force-stop io.phoneweave.agent
    adb -s "$serial" shell am start -n io.phoneweave.agent/.ui.MainActivity
    echo "[PhoneWeave] App launched."
    ;;
  status|*)
    echo "============================================================"
    echo " PhoneWeave Android Agent 运行状态诊断 ($serial)"
    echo "============================================================"

    # Device info
    model="$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
    brand="$(adb -s "$serial" shell getprop ro.product.brand | tr -d '\r')"
    release="$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
    sdk="$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
    res="$(adb -s "$serial" shell wm size 2>/dev/null | grep "Physical size:" | awk '{print $3}' | tr -d '\r')"
    echo "【设备信息】 $brand $model (Android $release, API $sdk, 分辨率: ${res:-未知})"

    # Package installed?
    pkg_info="$(adb -s "$serial" shell dumpsys package io.phoneweave.agent 2>/dev/null | grep -E "versionName|versionCode" | head -2 | tr -d '\r ')"
    if [[ -n "$pkg_info" ]]; then
      echo "【APK 安装】 已安装 ($pkg_info)"
    else
      echo "【APK 安装】 ❌ 未安装 io.phoneweave.agent，请执行 ./phoneweave android-install"
    fi

    # Process running?
    pid="$(adb -s "$serial" shell pidof io.phoneweave.agent | tr -d '\r ' || true)"
    if [[ -n "$pid" ]]; then
      echo "【进程状态】 ✅ 正在运行 (PID: $pid)"
    else
      echo "【进程状态】 ⚪ 未运行 (可执行 ./phoneweave android-status restart 启动)"
    fi

    # Accessibility enabled?
    acc_services="$(adb -s "$serial" shell settings get secure enabled_accessibility_services | tr -d '\r')"
    if [[ "$acc_services" == *"io.phoneweave.agent"* ]]; then
      echo "【无障碍服务】 ✅ 已开启 (PhoneWeaveAccessibilityService)"
    else
      echo "【无障碍服务】 ⚠️ 未开启或未授权 (请在手机 系统设置 -> 无障碍 中开启 PhoneWeave)"
    fi

    # Shared preferences config
    prefs="$(adb -s "$serial" shell "run-as io.phoneweave.agent cat /data/data/io.phoneweave.agent/shared_prefs/phoneweave.xml" 2>/dev/null || adb -s "$serial" shell "cat /data/data/io.phoneweave.agent/shared_prefs/phoneweave.xml" 2>/dev/null || true)"
    if [[ -n "$prefs" ]]; then
      server_url="$(echo "$prefs" | grep -o 'name="server">[^<]*' | cut -d'>' -f2 || true)"
      device_id="$(echo "$prefs" | grep -o 'name="device_id">[^<]*' | cut -d'>' -f2 || true)"
      device_token="$(echo "$prefs" | grep -o 'name="device_token">[^<]*' | cut -d'>' -f2 || true)"
      echo "【当前配置】"
      echo "  - Server URL:    ${server_url:-未设置}"
      echo "  - Device ID:     ${device_id:-未设置}"
      echo "  - Device Token:  ${device_token:-未设置}"
    fi

    echo "============================================================"
    echo "常用观测命令:"
    echo "  - 实时查看应用日志:   ./phoneweave logs-android"
    echo "  - 截取当前手机屏幕:   ./phoneweave android-status screenshot"
    echo "  - 重新启动 Agent 应用: ./phoneweave android-status restart"
    echo "============================================================"
    ;;
esac
