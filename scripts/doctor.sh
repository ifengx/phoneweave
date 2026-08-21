#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_env
sdk=""
if sdk="$(configure_android_env 2>/dev/null)"; then :; else sdk="NOT FOUND"; fi
printf "%-24s %s\n" "Project" "$ROOT"
printf "%-24s %s\n" "Node" "$(node -v 2>/dev/null || echo MISSING)"
printf "%-24s %s\n" "npm" "$(npm -v 2>/dev/null || echo MISSING)"
printf "%-24s %s\n" "Java" "$(java -version 2>&1 | head -1 || echo MISSING)"
printf "%-24s %s\n" "JAVA_HOME" "${JAVA_HOME:-UNSET}"
printf "%-24s %s\n" "Android SDK" "$sdk"
printf "%-24s %s\n" "adb" "$(adb version 2>/dev/null | head -1 || echo MISSING)"
printf "%-24s %s\n" "emulator" "$(command -v emulator 2>/dev/null || echo MISSING)"
printf "%-24s %s\n" "Docker" "$(docker --version 2>/dev/null || echo MISSING)"
printf "%-24s %s\n" ".env" "$([[ -f "$ROOT/.env" ]] && echo present || echo missing)"
if command -v adb >/dev/null; then
  echo
  adb devices || true
fi
