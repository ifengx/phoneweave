#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

cleanup_files=()
cleanup() {
  local file
  for file in "${cleanup_files[@]:-}"; do
    [[ ! -f "$file" ]] || rm -f "$file"
  done
}
trap cleanup EXIT

main() {
  load_project_env
  [[ -f "$PROJECT_ROOT/agent-version.properties" ]] || die "Missing $PROJECT_ROOT/agent-version.properties"
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/agent-version.properties"
  remote_preflight

  ensure_shared_network

  local server_ip control_port turn_ip public_url release_id release_dir
  local remote_dir remote_compose_file remote_env_file archive runtime_env sudo_mode sudo_cmd remote_archive
  server_ip="${PHONEWEAVE_SERVER_IP:-${DEPLOY_TARGET##*@}}"
  control_port="${PORT:-8787}"
  turn_ip="${TURN_EXTERNAL_IP:-$server_ip}"
  public_url="http://$server_ip:$control_port"
  [[ "$control_port" =~ ^[0-9]+$ ]] || die "Invalid control port: $control_port"

  release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  remote_dir="$REMOTE_ROOT/application/web"
  release_dir="$remote_dir/releases/$release_id"
  remote_compose_file="$remote_dir/compose.yml"
  remote_env_file="$remote_dir/.env"
  remote_archive="$remote_dir/source-$release_id.tar.gz"

  archive="$(mktemp "${TMPDIR:-/tmp}/phoneweave-web-source.XXXXXX.tar.gz")"
  runtime_env="$(mktemp "${TMPDIR:-/tmp}/phoneweave-web-env.XXXXXX")"
  cleanup_files+=("$archive" "$runtime_env")
  "$PROJECT_ROOT/scripts/build-web.sh"
  COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --exclude=node_modules --exclude=build \
    -czf "$archive" -C "$PROJECT_ROOT" server web-console
  remote_install_file "$archive" "$remote_archive" 0600
  sudo_mode="$(remote_sudo)" || die "Remote user must be root or have passwordless sudo"
  [[ "$sudo_mode" == root ]] && sudo_cmd="" || sudo_cmd="sudo"
  remote_exec "$sudo_cmd install -d -m 0755 '$release_dir' && $sudo_cmd tar -xzf '$remote_archive' -C '$release_dir' && $sudo_cmd rm -f '$remote_archive'"
  remote_install_file "$DEPLOY_ROOT/application/web/Dockerfile" "$release_dir/Dockerfile"

  chmod 600 "$runtime_env"
  {
    printf 'SOURCE_DIR=%s\n' "$release_dir"
    printf 'PORT=8787\n'
    printf 'PHONEWEAVE_ADMIN_TOKEN=%s\n' "${PHONEWEAVE_ADMIN_TOKEN:-change-me-admin}"
    printf 'PHONEWEAVE_DEVICE_TOKEN=%s\n' "${PHONEWEAVE_DEVICE_TOKEN:-change-me-device}"
    printf 'WEB_TOKEN=%s\n' "${WEB_TOKEN:-}"
    printf 'WEB_SESSION_TTL_SECONDS=%s\n' "${WEB_SESSION_TTL_SECONDS:-43200}"
    printf 'PHONEWEAVE_AGENT_VERSION_NAME=%s\n' "$PHONEWEAVE_AGENT_VERSION_NAME"
    printf 'PHONEWEAVE_AGENT_VERSION_CODE=%s\n' "$PHONEWEAVE_AGENT_VERSION_CODE"
    printf 'PHONEWEAVE_MAX_UPLOAD_BYTES=%s\n' "${PHONEWEAVE_MAX_UPLOAD_BYTES:-536870912}"
    printf 'PHONEWEAVE_HTTP_REQUEST_TIMEOUT_MS=%s\n' "${PHONEWEAVE_HTTP_REQUEST_TIMEOUT_MS:-1800000}"
    printf 'PUBLIC_BASE_URL=%s\n' "$public_url"
    printf 'STUN_URL=%s\n' "${STUN_URL:-stun:stun.l.google.com:19302}"
    printf 'TURN_URL=turn:%s:3478\n' "$turn_ip"
    printf 'TURN_USER=%s\n' "${TURN_USER:-phoneweave}"
    printf 'TURN_PASSWORD=%s\n' "${TURN_PASSWORD:-change-me-turn}"
    printf 'LOG_LEVEL=%s\n' "${LOG_LEVEL:-info}"
  } >"$runtime_env"

  remote_install_file "$DEPLOY_ROOT/application/web/compose.yml" "$remote_compose_file"
  remote_install_file "$runtime_env" "$remote_env_file" 0600
  info "Building and deploying PhoneWeave control server at $public_url"
  remote_compose phoneweave-web "$remote_compose_file" "--env-file '$remote_env_file' up -d --build --remove-orphans"

  remote_docker "inspect --format '{{json .NetworkSettings.Networks}}' phoneweave-control-server | grep -q '\"$SHARED_NETWORK\"'"
  remote_docker "inspect --format '{{.State.Running}}' phoneweave-control-server | grep -qx true"
  remote_docker "exec phoneweave-control-server wget -q -O - http://127.0.0.1:8787/api/health >/dev/null"
  info "Control server deployed: $public_url"
  info "Android Server URL: $public_url"
  info "TURN URL delivered to clients: turn:$turn_ip:3478"
}

main "$@"
