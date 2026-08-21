#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"
VERSION=9.4.1
TOOLS="$ROOT/.tools"
DIST="$TOOLS/gradle-$VERSION"
ZIP="$TOOLS/gradle-$VERSION-bin.zip"

# AGP 9.x requires the pinned Gradle line. Do not silently pick an unrelated
# system/asdf Gradle, because that makes otherwise identical builds diverge.
gradle_user_dir="${GRADLE_USER_HOME:-${HOME}/.gradle}"
cached_gradle=""
if [[ -d "$gradle_user_dir/wrapper/dists/gradle-$VERSION-bin" ]]; then
  cached_gradle="$(find "$gradle_user_dir/wrapper/dists/gradle-$VERSION-bin" -path "*/gradle-$VERSION/bin/gradle" -type f -perm +111 -print -quit 2>/dev/null || true)"
fi
if [[ -n "$cached_gradle" ]]; then
  exec "$cached_gradle" "$@"
fi

if [[ ! -x "$DIST/bin/gradle" ]]; then
  mkdir -p "$TOOLS"
  command -v curl >/dev/null || { echo "curl required to download Gradle" >&2; exit 1; }
  command -v unzip >/dev/null || { echo "unzip required to unpack Gradle" >&2; exit 1; }
  echo "[PhoneWeave] downloading Gradle $VERSION..."
  curl -fL "https://services.gradle.org/distributions/gradle-$VERSION-bin.zip" -o "$ZIP"
  rm -rf "$DIST"
  unzip -q "$ZIP" -d "$TOOLS"
fi
exec "$DIST/bin/gradle" "$@"
