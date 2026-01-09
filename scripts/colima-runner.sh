#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mount_target="${COLIMA_RUNNER_MOUNT:-/workspace}"
image="${COLIMA_RUNNER_IMAGE:-node:latest}"
profile_env="${COLIMA_PROFILE:-}"
profile="${profile_env:-default}"
docker_args_env="${RUNNER_DOCKER_ARGS:-${COLIMA_DOCKER_ARGS:-}}"
export_logs="${COLIMA_RUNNER_EXPORT_LOGS:-1}"
log_export_dir_host="${COLIMA_RUNNER_LOG_EXPORT_DIR:-${repo_root}/.colima-logs}"
log_export_mount="${COLIMA_RUNNER_LOG_EXPORT_MOUNT:-/log-export}"

docker_args_list=()
if [ -n "${docker_args_env}" ]; then
  # shellcheck disable=SC2206
  docker_args_list=(${docker_args_env})
fi

engine="${CONTAINER_ENGINE:-docker}"
if ! command -v "${engine}" >/dev/null 2>&1; then
  if [ "${engine}" = "docker" ] && command -v podman >/dev/null 2>&1; then
    engine="podman"
  fi
fi

if ! command -v "${engine}" >/dev/null 2>&1; then
  echo "${engine} command not found. Install Docker (or set CONTAINER_ENGINE)." >&2
  exit 1
fi

docker_context=""
if [ "${engine}" = "docker" ]; then
  docker_context="$(docker context show 2>/dev/null || true)"
fi

docker_context_name=""
host_mount_source="${repo_root}"
if [[ "${docker_context}" == colima* ]]; then
  if ! command -v colima >/dev/null 2>&1; then
    echo "Docker context is 'colima' but colima command not found." >&2
    exit 1
  fi

  if [ -z "${profile_env}" ]; then
    repo_basename="$(basename "${repo_root}")"
    profile="${repo_basename}-runner"
  fi

  if [ "${profile}" = "default" ]; then
    docker_context_name="colima"
  else
    docker_context_name="colima-${profile}"
  fi

  colima_running=false
  if colima status --profile "${profile}" >/dev/null 2>&1; then
    colima_running=true
  fi

  colima_mount_cmd=(start --profile "${profile}" --activate=false --mount "${repo_root}:${mount_target}:w")
  if [ "${colima_running}" != true ]; then
    colima "${colima_mount_cmd[@]}"
  fi

  colima_has_repo_mount() {
    colima ssh --profile "${profile}" -- test -f "${mount_target}/package.json" >/dev/null 2>&1 && return 0
    colima ssh --profile "${profile}" -- test -f "${mount_target}/package-lock.json" >/dev/null 2>&1
  }

  colima_mount_ok=false
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if colima_has_repo_mount; then
      colima_mount_ok=true
      break
    fi
    sleep 1
  done

  if [ "${colima_mount_ok}" != true ]; then
    if [ -z "${profile_env}" ]; then
      colima stop --profile "${profile}"
      colima "${colima_mount_cmd[@]}"

      for _ in 1 2 3 4 5 6 7 8 9 10; do
        if colima_has_repo_mount; then
          colima_mount_ok=true
          break
        fi
        sleep 1
      done
    fi
  fi

  if [ "${colima_mount_ok}" != true ]; then
    echo "Colima profile '${profile}' is running without the required mount for ${repo_root}." >&2
    echo "Restart it with: colima stop --profile '${profile}' && colima ${colima_mount_cmd[*]}" >&2
    exit 1
  fi

  host_mount_source="${mount_target}"
fi

log_export_volume=()
if [ "${export_logs}" = "1" ]; then
  mkdir -p "${log_export_dir_host}"
  log_export_volume=(-v "${log_export_dir_host}:${log_export_mount}:rw")
fi

tty_flags=()
if [ -t 0 ] && [ -t 1 ]; then
  tty_flags=(-it)
fi

docker_run_common=("${engine}")
if [ -n "${docker_context_name}" ] && [ "${engine}" = "docker" ]; then
  docker_run_common+=(--context "${docker_context_name}")
fi

docker_run_common+=(run --rm)
if [ "${#tty_flags[@]}" -gt 0 ]; then
  docker_run_common+=("${tty_flags[@]}")
fi

docker_run_common+=(-v "${host_mount_source}:${mount_target}:rw" -w "${mount_target}")

if [ "${#log_export_volume[@]}" -gt 0 ]; then
  docker_run_common+=("${log_export_volume[@]}")
fi

if [ "${#docker_args_list[@]}" -gt 0 ]; then
  docker_run_common+=("${docker_args_list[@]}")
fi

if [ $# -eq 0 ]; then
  echo "No command provided. Starting interactive shell..."
  exec "${docker_run_common[@]}" "${image}"
fi

custom_commands=("$@")
container_commands=(
  "workspace_dir=\"${mount_target}\""
  "build_dir=\$(mktemp -d)"
  "cleanup_build_dir() { rm -rf \"\${build_dir}\"; }"
  "trap cleanup_build_dir EXIT"
  "rm -rf /root/.poe-code"
  "mkdir -p /root/.poe-code/logs"
  "tar -C \"\${workspace_dir}\" --exclude=node_modules --exclude=.git -cf - . | tar -C \"\${build_dir}\" -xf -"
  "cd \"\${build_dir}\""
  "npm install"
  "npm run build"
  "npm install -g ."
  "cd \"\${workspace_dir}\""
)
container_commands+=("${custom_commands[@]}")

if [ "${export_logs}" = "1" ]; then
  container_commands+=(
    "mkdir -p \"${log_export_mount}\""
    "cp -a /root/.poe-code/logs/. \"${log_export_mount}/\" || true"
  )
fi

command_string="set -e"
for cmd in "${container_commands[@]}"; do
  command_string+="; ${cmd}"
done

exec "${docker_run_common[@]}" "${image}" sh -lc "${command_string}"
