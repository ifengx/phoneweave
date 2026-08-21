#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_ROOT/deploy/lib/common.sh"

on_error() {
  local line="$1"
  echo "[PhoneWeave deploy] One-click deployment failed near line $line." >&2
  echo "[PhoneWeave deploy] Fix the reported error and run ./deploy-server.sh again." >&2
}
trap 'on_error "$LINENO"' ERR

verify_applications() {
  remote_docker "inspect --format '{{.State.Running}}' phoneweave-turn | grep -qx true"
  remote_docker "inspect --format '{{.State.Running}}' phoneweave-control-server | grep -qx true"
  remote_docker "inspect --format '{{json .NetworkSettings.Networks}}' phoneweave-turn | grep -q '\"$SHARED_NETWORK\"'"
  remote_docker "inspect --format '{{json .NetworkSettings.Networks}}' phoneweave-control-server | grep -q '\"$SHARED_NETWORK\"'"
}

main() {
  load_project_env
  remote_preflight
  ensure_shared_network

  info "Starting deployment to $DEPLOY_TARGET"

  info "Deploying TURN application"
  "$SCRIPT_ROOT/phoneweave" deploy-turn

  info "Deploying Web Console and control server"
  "$SCRIPT_ROOT/phoneweave" deploy-web

  verify_applications

  local server_ip control_port public_url
  server_ip="${PHONEWEAVE_SERVER_IP:-${DEPLOY_TARGET##*@}}"
  control_port="${PORT:-8787}"
  public_url="http://$server_ip:$control_port"

  require_local_command curl
  if curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors \
    "$public_url/api/health" >/dev/null; then
    info "Public health check passed: $public_url/api/health"
  else
    info "Warning: containers are running, please verify $public_url/api/health"
  fi

  cat <<SUMMARY

[PhoneWeave deploy] Deployment complete
  Web Console:   $public_url
  Android URL:   $public_url
  TURN URL:      turn:$server_ip:3478
  Docker network: $SHARED_NETWORK
SUMMARY
}

main "$@"
