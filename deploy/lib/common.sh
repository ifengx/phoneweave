#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$DEPLOY_ROOT/.." && pwd)"
DEPLOY_TARGET_OVERRIDE="${PHONEWEAVE_DEPLOY_TARGET:-}"
REMOTE_ROOT_OVERRIDE="${PHONEWEAVE_REMOTE_ROOT:-}"
DEPLOY_TARGET="${DEPLOY_TARGET_OVERRIDE:-${PHONEWEAVE_DEPLOY_TARGET:-}}"
REMOTE_ROOT="${REMOTE_ROOT_OVERRIDE:-${PHONEWEAVE_REMOTE_ROOT:-/opt/phoneweave}}"
SHARED_NETWORK="phoneweave-edge"

die() {
  echo "[PhoneWeave deploy] $*" >&2
  exit 1
}

info() {
  echo "[PhoneWeave deploy] $*"
}

require_local_command() {
  command -v "$1" >/dev/null 2>&1 || die "Local command is required: $1"
}

load_project_env() {
  [[ -f "$PROJECT_ROOT/.env" ]] || die "Missing $PROJECT_ROOT/.env"
  set -a
  # The project owns this dotenv file; keep it out of logs because it contains secrets.
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  DEPLOY_TARGET="${DEPLOY_TARGET_OVERRIDE:-${PHONEWEAVE_DEPLOY_TARGET:-}}"
  REMOTE_ROOT="${REMOTE_ROOT_OVERRIDE:-${PHONEWEAVE_REMOTE_ROOT:-/opt/phoneweave}}"
}

validate_target() {
  [[ "$DEPLOY_TARGET" =~ ^([a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+$ ]] || \
    die "Invalid SSH target: $DEPLOY_TARGET"
  [[ "$REMOTE_ROOT" =~ ^/[a-zA-Z0-9._/-]+$ ]] || \
    die "Invalid remote deployment root: $REMOTE_ROOT"
}

remote_sudo() {
  ssh "$DEPLOY_TARGET" 'if [ "$(id -u)" -eq 0 ]; then printf root; elif sudo -n true 2>/dev/null; then printf sudo; else exit 77; fi'
}

remote_exec() {
  ssh "$DEPLOY_TARGET" "$@"
}

remote_install_file() {
  local source_file="$1"
  local destination="$2"
  local mode="${3:-0644}"
  local remote_temp sudo_mode sudo_cmd
  remote_temp="$(ssh "$DEPLOY_TARGET" 'mktemp /tmp/phoneweave-deploy.XXXXXX')"
  [[ "$remote_temp" =~ ^/tmp/phoneweave-deploy\.[a-zA-Z0-9]+$ ]] || \
    die "Remote mktemp returned an unsafe path"
  scp -q "$source_file" "$DEPLOY_TARGET:$remote_temp"
  sudo_mode="$(remote_sudo)" || die "Remote user must be root or have passwordless sudo"
  [[ "$sudo_mode" == root ]] && sudo_cmd="" || sudo_cmd="sudo"
  ssh "$DEPLOY_TARGET" \
    "$sudo_cmd mkdir -p '$(dirname "$destination")' && $sudo_cmd install -m '$mode' '$remote_temp' '$destination' && rm -f '$remote_temp'"
}

remote_docker() {
  local sudo_mode sudo_cmd
  sudo_mode="$(remote_sudo)" || die "Remote user must be root or have passwordless sudo"
  [[ "$sudo_mode" == root ]] && sudo_cmd="" || sudo_cmd="sudo"
  ssh "$DEPLOY_TARGET" "$sudo_cmd docker $*"
}

remote_preflight() {
  validate_target
  require_local_command ssh
  require_local_command scp
  info "Checking Docker on $DEPLOY_TARGET"
  remote_exec 'command -v docker >/dev/null' || \
    die "Docker Engine is required on $DEPLOY_TARGET"
  remote_sudo >/dev/null || die "Remote user must be root or have passwordless sudo"
  remote_docker 'compose version >/dev/null' || \
    die "Docker Compose v2 is required on $DEPLOY_TARGET"
}

ensure_shared_network() {
  if ! remote_docker "network inspect '$SHARED_NETWORK' >/dev/null 2>&1"; then
    info "Creating external Docker network $SHARED_NETWORK"
    remote_docker "network create --driver bridge '$SHARED_NETWORK' >/dev/null"
  fi
}

remote_compose() {
  local project="$1"
  local compose_file="$2"
  shift 2
  local sudo_mode sudo_cmd
  sudo_mode="$(remote_sudo)" || die "Remote user must be root or have passwordless sudo"
  [[ "$sudo_mode" == root ]] && sudo_cmd="" || sudo_cmd="sudo"
  ssh "$DEPLOY_TARGET" "$sudo_cmd docker compose --project-name '$project' --file '$compose_file' $*"
}

validate_simple_secret() {
  local name="$1"
  local value="$2"
  [[ -n "$value" ]] || die "$name is required in .env"
  [[ "$value" =~ ^[a-zA-Z0-9._~!@#%+^=-]+$ ]] || \
    die "$name contains unsupported characters; use letters, digits, or ._~!@#%+^=-"
}
