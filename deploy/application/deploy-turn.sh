#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

cleanup_file=""
cleanup() {
  [[ -z "$cleanup_file" || ! -f "$cleanup_file" ]] || rm -f "$cleanup_file"
}
trap cleanup EXIT

main() {
  load_project_env
  remote_preflight

  ensure_shared_network

  local public_ip realm remote_dir remote_compose_file remote_env_file
  public_ip="${TURN_EXTERNAL_IP:-${DEPLOY_TARGET##*@}}"
  realm="${TURN_REALM:-$public_ip}"

  validate_simple_secret TURN_USER "${TURN_USER:-phoneweave}"
  validate_simple_secret TURN_PASSWORD "${TURN_PASSWORD:-change-me-turn}"

  remote_dir="$REMOTE_ROOT/application/turn"
  remote_compose_file="$remote_dir/compose.yml"
  remote_env_file="$remote_dir/.env"
  remote_install_file "$DEPLOY_ROOT/application/turn/compose.yml" "$remote_compose_file"

  cleanup_file="$(mktemp "${TMPDIR:-/tmp}/phoneweave-turn-env.XXXXXX")"
  chmod 600 "$cleanup_file"
  {
    printf 'TURN_USER=%s\n' "${TURN_USER:-phoneweave}"
    printf 'TURN_PASSWORD=%s\n' "${TURN_PASSWORD:-change-me-turn}"
    printf 'TURN_REALM=%s\n' "$realm"
    printf 'TURN_EXTERNAL_IP=%s\n' "$public_ip"
  } >"$cleanup_file"
  remote_install_file "$cleanup_file" "$remote_env_file" 0600

  info "Deploying TURN application on $public_ip:3478"
  if [[ "${PHONEWEAVE_SKIP_PULL:-0}" != 1 ]] && \
    ! remote_compose phoneweave-turn "$remote_compose_file" "--env-file '$remote_env_file' pull"; then
      info "Registry pull failed; continuing with the cached coturn image"
  fi
  remote_compose phoneweave-turn "$remote_compose_file" "--env-file '$remote_env_file' up -d --remove-orphans"

  remote_docker "inspect --format '{{json .NetworkSettings.Networks}}' phoneweave-turn | grep -q '\"$SHARED_NETWORK\"'"
  remote_docker "inspect --format '{{.State.Running}}' phoneweave-turn | grep -qx true"
  remote_docker "exec phoneweave-turn turnutils_stunclient -p 3478 127.0.0.1 >/dev/null 2>&1" || \
    die "TURN container started but its STUN listener probe failed"

  info "TURN deployed: turn:$public_ip:3478"
}

main "$@"
