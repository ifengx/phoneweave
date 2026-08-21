#!/usr/bin/env bash
# Shared Android SDK discovery for macOS/Linux development.
# Source this file; do not execute it directly.

phoneweave_detect_android_sdk() {
  local root="${ROOT:-$(pwd)}"
  local candidates=()

  [[ -n "${ANDROID_HOME:-}" ]] && candidates+=("$ANDROID_HOME")
  [[ -n "${ANDROID_SDK_ROOT:-}" ]] && candidates+=("$ANDROID_SDK_ROOT")

  # Gradle's canonical project-local SDK pointer.
  local lp="$root/android-agent/local.properties"
  if [[ -f "$lp" ]]; then
    local sdk_from_props
    sdk_from_props="$(sed -n 's/^sdk\.dir=//p' "$lp" | head -1 | sed 's/\\:/:/g; s/\\\\/\\/g')"
    [[ -n "$sdk_from_props" ]] && candidates+=("$sdk_from_props")
  fi

  # Android Studio default on macOS.
  [[ -n "${HOME:-}" ]] && candidates+=("$HOME/Library/Android/sdk")

  # Common Linux defaults, harmless on macOS.
  [[ -n "${HOME:-}" ]] && candidates+=("$HOME/Android/Sdk" "$HOME/Android/sdk")

  local sdk
  for sdk in "${candidates[@]}"; do
    if [[ -d "$sdk" && -d "$sdk/platform-tools" ]]; then
      printf '%s\n' "$sdk"
      return 0
    fi
  done
  return 1
}

phoneweave_configure_android_java() {
  # Android Studio bundles a JetBrains Runtime/JDK on macOS. Use it when the
  # shell has no usable JAVA_HOME so VS Code/terminal builds behave like Studio.
  if [[ -z "${JAVA_HOME:-}" ]]; then
    local studio_jbr="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    if [[ -x "$studio_jbr/bin/java" ]]; then
      export JAVA_HOME="$studio_jbr"
      export PATH="$JAVA_HOME/bin:$PATH"
    fi
  fi
}

phoneweave_configure_android_env() {
  phoneweave_configure_android_java
  local sdk
  if ! sdk="$(phoneweave_detect_android_sdk)"; then
    cat >&2 <<'MSG'
[PhoneWeave] Android SDK not found.
On macOS with Android Studio it is usually:
  ~/Library/Android/sdk

Check Android Studio > Settings/Preferences > Languages & Frameworks > Android SDK,
or run:
  ls -ld "$HOME/Library/Android/sdk"
MSG
    return 1
  fi

  export ANDROID_HOME="$sdk"
  export ANDROID_SDK_ROOT="$sdk"
  export PATH="$sdk/platform-tools:$sdk/emulator:$sdk/cmdline-tools/latest/bin:$PATH"

  # Keep Gradle/Android Studio/VS Code on the same SDK without requiring shell env vars.
  local lp="${ROOT:-$(pwd)}/android-agent/local.properties"
  if [[ ! -f "$lp" ]] || ! grep -q '^sdk.dir=' "$lp"; then
    printf 'sdk.dir=%s\n' "$sdk" > "$lp"
  fi

  printf '%s\n' "$sdk"
}
