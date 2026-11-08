#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILED=0
STOP=0

LINT_LABEL="lint:workflows"
ACT_LABEL="act --list"
FAST_LABEL="test:workflows:fast"
FULL_LABEL="test:workflows"

LINT_STATUS="SKIPPED"
ACT_STATUS="SKIPPED"
FAST_STATUS="SKIPPED"
FULL_STATUS="SKIPPED"

run_section() {
  local status_var="$1"
  local label="$2"
  shift 2

  if [ "$STOP" -eq 1 ]; then
    printf 'SKIPPED %s\n' "$label"
    printf -v "$status_var" '%s' "SKIPPED"
    return 0
  fi

  printf 'RUNNING %s\n' "$label"
  if "$@"; then
    printf 'PASSED %s\n' "$label"
    printf -v "$status_var" '%s' "PASSED"
    return 0
  fi

  printf 'FAILED %s\n' "$label"
  printf -v "$status_var" '%s' "FAILED"
  FAILED=1
  STOP=1
  return 1
}

print_summary() {
  printf '\nSummary\n'
  printf '%s %s\n' "$LINT_STATUS" "$LINT_LABEL"
  printf '%s %s\n' "$ACT_STATUS" "$ACT_LABEL"
  printf '%s %s\n' "$FAST_STATUS" "$FAST_LABEL"
  printf '%s %s\n' "$FULL_STATUS" "$FULL_LABEL"
}

cd "$REPO_ROOT" || exit 1

run_section LINT_STATUS "$LINT_LABEL" npm run lint:workflows
run_section ACT_STATUS "$ACT_LABEL" act --list
run_section FAST_STATUS "$FAST_LABEL" npm run test:workflows:fast

if [ "${ACT_FULL:-0}" = "1" ]; then
  run_section FULL_STATUS "$FULL_LABEL" npm run test:workflows
fi

print_summary
exit "$FAILED"
