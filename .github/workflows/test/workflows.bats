#!/usr/bin/env bats

setup_file() {
  export REPO_ROOT
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../.." && pwd)"
  export TEST_WORKFLOWS_SCRIPT="$REPO_ROOT/scripts/test-workflows.sh"
  export NODE_IMAGE="node:20-bookworm"

  CHECK_USER_ALLOW_SCRIPT="$(cat <<'EOF'
import { loadAutomation } from "./packages/github-workflows/dist/discover.js";
import { checkUserAllow } from "./packages/github-workflows/dist/exec/check-user-allow.js";

const automation = await loadAutomation("github-issue-comment-created", ["./packages/github-workflows/src/prompts"]);
if (automation === undefined) {
  throw new Error('Unable to load "github-issue-comment-created" automation.');
}

checkUserAllow(automation, process.env.COMMENT_AUTHOR_ASSOCIATION);
EOF
)"
  export CHECK_USER_ALLOW_SCRIPT

  REQUIRE_COMMENT_PREFIX_SCRIPT="$(cat <<'EOF'
import { loadAutomation } from "./packages/github-workflows/dist/discover.js";
import { requireCommentPrefix } from "./packages/github-workflows/dist/exec/require-comment-prefix.js";

const automation = await loadAutomation("github-issue-comment-created", ["./packages/github-workflows/src/prompts"]);
if (automation === undefined) {
  throw new Error('Unable to load "github-issue-comment-created" automation.');
}

requireCommentPrefix(automation, process.env.COMMENT_BODY);
EOF
)"
  export REQUIRE_COMMENT_PREFIX_SCRIPT
}

setup() {
  cd "$REPO_ROOT"
}

yaml_eval() {
  local file_path="$1"
  local expression="$2"

  node --input-type=module - "$file_path" "$expression" <<'EOF'
import fs from "node:fs";
import YAML from "yaml";

const [, , filePath, expression] = process.argv;
const workflow = YAML.parse(fs.readFileSync(filePath, "utf8"));
const result = Function("workflow", `return (${expression});`)(workflow);

if (typeof result === "string") {
  process.stdout.write(result);
  process.exit(0);
}

process.stdout.write(JSON.stringify(result));
EOF
}

json_fixture_field() {
  local file_path="$1"
  local expression="$2"

  node --input-type=module - "$file_path" "$expression" <<'EOF'
import fs from "node:fs";

const [, , filePath, expression] = process.argv;
const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
const result = Function("fixture", `return (${expression});`)(fixture);

if (result === undefined) {
  process.exit(1);
}

process.stdout.write(String(result));
EOF
}

workflow_run_steps() {
  local file_path="$1"

  node --input-type=module - "$file_path" <<'EOF'
import fs from "node:fs";
import YAML from "yaml";

const [, , filePath] = process.argv;
const workflow = YAML.parse(fs.readFileSync(filePath, "utf8"));
const steps = workflow.jobs.run.steps
  .filter((step) => typeof step.run === "string")
  .map((step) => step.run);

process.stdout.write(steps.join("\n"));
EOF
}

workflow_permissions() {
  local file_path="$1"
  local expression="$2"

  node --input-type=module - "$file_path" "$expression" <<'EOF'
import fs from "node:fs";
import YAML from "yaml";

const [, , filePath, expression] = process.argv;
const workflow = YAML.parse(fs.readFileSync(filePath, "utf8"));
const result = Function("workflow", `return (${expression});`)(workflow);

process.stdout.write(JSON.stringify(result ?? {}));
EOF
}

workflow_reusable_path() {
  local file_path="$1"

  node --input-type=module - "$file_path" <<'EOF'
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const [, , filePath] = process.argv;
const workflow = YAML.parse(fs.readFileSync(filePath, "utf8"));
const uses = workflow.jobs?.run?.uses;

if (typeof uses !== "string") {
  throw new Error(`${filePath} does not declare jobs.run.uses.`);
}

const marker = ".github/workflows/";
const markerIndex = uses.indexOf(marker);

if (markerIndex === -1) {
  throw new Error(`${filePath} does not reference a reusable workflow.`);
}

const reusableWithRef = uses.slice(markerIndex + marker.length);
const refIndex = reusableWithRef.indexOf("@");

if (refIndex === -1) {
  throw new Error(`${filePath} does not pin a reusable workflow ref.`);
}

const reusableFileName = reusableWithRef.slice(0, refIndex);

if (!reusableFileName.startsWith("gh-")) {
  throw new Error(`${filePath} does not reference a gh-* reusable workflow.`);
}

process.stdout.write(path.posix.join(".github/workflows", reusableFileName));
EOF
}

test_workflows_script_command() {
  cat <<'EOF'
npm() {
  printf 'MOCK npm %s\n' "$*"
  if [ "${ASSERT_REPO_ROOT:-0}" = "1" ] && [ "$PWD" != "$REPO_ROOT" ]; then
    printf 'Expected repo root %s, got %s\n' "$REPO_ROOT" "$PWD" >&2
    return 98
  fi

  case "$*" in
    'run lint:workflows')
      return "${MOCK_NPM_LINT_EXIT:-0}"
      ;;
    'run test:workflows:fast')
      return "${MOCK_NPM_FAST_EXIT:-0}"
      ;;
    'run test:workflows')
      return "${MOCK_NPM_FULL_EXIT:-0}"
      ;;
    *)
      printf 'Unexpected npm invocation: %s\n' "$*" >&2
      return 99
      ;;
  esac
}

act() {
  printf 'MOCK act %s\n' "$*"
  if [ "${ASSERT_REPO_ROOT:-0}" = "1" ] && [ "$PWD" != "$REPO_ROOT" ]; then
    printf 'Expected repo root %s, got %s\n' "$REPO_ROOT" "$PWD" >&2
    return 98
  fi

  case "$*" in
    '--list')
      return "${MOCK_ACT_LIST_EXIT:-0}"
      ;;
    *)
      printf 'Unexpected act invocation: %s\n' "$*" >&2
      return 99
      ;;
  esac
}

export -f npm act
bash "$TEST_WORKFLOWS_SCRIPT"
EOF
}

require_docker() {
  docker info >/dev/null 2>&1 || skip "Docker is required for guard-step execution tests."
}

run_guard_in_docker() {
  local guard_name="$1"
  local fixture_path="$2"
  local env_name
  local env_value
  local script

  case "$guard_name" in
    check-user-allow)
      env_name="COMMENT_AUTHOR_ASSOCIATION"
      env_value="$(json_fixture_field "$fixture_path" 'fixture.comment.author_association')"
      script="$CHECK_USER_ALLOW_SCRIPT"
      ;;
    require-comment-prefix)
      env_name="COMMENT_BODY"
      env_value="$(json_fixture_field "$fixture_path" 'fixture.comment.body')"
      script="$REQUIRE_COMMENT_PREFIX_SCRIPT"
      ;;
    *)
      printf 'Unknown guard: %s\n' "$guard_name" >&2
      return 1
      ;;
  esac

  docker run --rm \
    -e "$env_name=$env_value" \
    -v "$REPO_ROOT:/workspace" \
    -w /workspace \
    "$NODE_IMAGE" \
    node --input-type=module -e "$script"
}

@test "dry-run gh reusable workflows parse without error" {
  shopt -s nullglob
  local gh_workflows=(.github/workflows/gh-*.yml)
  [ "${#gh_workflows[@]}" -eq 7 ]

  local workflow
  for workflow in "${gh_workflows[@]}"; do
    run yaml_eval "$workflow" 'workflow.name'
    [ "$status" -eq 0 ]
    [ -n "$output" ]
  done
}

@test "dry-run issue comment workflow runs guard steps before the agent step" {
  run workflow_run_steps ".github/workflows/gh-github-issue-comment-created.yml"
  [ "$status" -eq 0 ]

  local allow_line
  allow_line="$(printf '%s\n' "$output" | grep -nF 'npx poe-code github-workflows exec check-user-allow github-issue-comment-created' | cut -d: -f1)"
  [ -n "$allow_line" ]

  local prefix_line
  prefix_line="$(printf '%s\n' "$output" | grep -nF 'npx poe-code github-workflows exec require-comment-prefix github-issue-comment-created' | cut -d: -f1)"
  [ -n "$prefix_line" ]

  local agent_line
  agent_line="$(printf '%s\n' "$output" | grep -nF 'npx poe-code github-workflows github-issue-comment-created --yes' | cut -d: -f1)"
  [ -n "$agent_line" ]

  [ "$allow_line" -lt "$prefix_line" ]
  [ "$prefix_line" -lt "$agent_line" ]
}

@test "dry-run reusable workflows declare workflow_call" {
  local reusable_workflows=(
    ".github/workflows/gh-fix-vulnerabilities.yml"
    ".github/workflows/gh-github-issue-comment-created.yml"
    ".github/workflows/gh-github-issue-opened.yml"
    ".github/workflows/gh-github-pull-request-opened.yml"
    ".github/workflows/gh-github-pull-request-synchronized.yml"
    ".github/workflows/gh-update-dependencies.yml"
    ".github/workflows/gh-update-documentation.yml"
    ".github/workflows/pr-checks.yml"
  )

  local workflow
  for workflow in "${reusable_workflows[@]}"; do
    run yaml_eval "$workflow" 'Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "workflow_call")'
    [ "$status" -eq 0 ]
    [ "$output" = "true" ]
  done
}

@test "dry-run caller workflows keep permissions in sync with reusable workflows" {
  shopt -s nullglob
  local caller_workflows=(
    .github/workflows/poe-code-*.yml
    packages/github-workflows/src/workflow-templates/*.caller.yml
  )

  [ "${#caller_workflows[@]}" -gt 0 ]

  local caller_path
  local reusable_path
  local caller_permissions
  local reusable_permissions

  for caller_path in "${caller_workflows[@]}"; do
    run workflow_reusable_path "$caller_path"
    [ "$status" -eq 0 ]
    reusable_path="$output"

    run workflow_permissions "$caller_path" 'workflow.permissions'
    [ "$status" -eq 0 ]
    caller_permissions="$output"

    run workflow_permissions "$reusable_path" 'workflow.jobs.run.permissions'
    [ "$status" -eq 0 ]
    reusable_permissions="$output"

    [ "$caller_permissions" = "$reusable_permissions" ]
  done
}

@test "dry-run PR checks entrypoint triggers on pull_request" {
  run yaml_eval ".github/workflows/pr-checks-pr.yml" 'Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "pull_request")'
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}

@test "dry-run workflow wrapper runs quick checks and skips Docker suite by default" {
  local shell_command
  shell_command="$(test_workflows_script_command)"

  run env PATH="$PATH" ACT_FULL=0 bash -lc "$shell_command"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED lint:workflows"* ]]
  [[ "$output" == *"PASSED act --list"* ]]
  [[ "$output" == *"PASSED test:workflows:fast"* ]]
  [[ "$output" == *"SKIPPED test:workflows"* ]]
  [[ "$output" != *$'MOCK npm run test:workflows\n'* ]]
}

@test "dry-run workflow wrapper fails fast when lint:workflows fails" {
  local shell_command
  shell_command="$(test_workflows_script_command)"

  run env PATH="$PATH" ACT_FULL=0 MOCK_NPM_LINT_EXIT=1 bash -lc "$shell_command"
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED lint:workflows"* ]]
  [[ "$output" == *"SKIPPED act --list"* ]]
  [[ "$output" == *"SKIPPED test:workflows:fast"* ]]
  [[ "$output" == *"SKIPPED test:workflows"* ]]
  [[ "$output" != *"MOCK act --list"* ]]
  [[ "$output" != *"MOCK npm run test:workflows:fast"* ]]
  [[ "$output" != *$'MOCK npm run test:workflows\n'* ]]
}

@test "dry-run workflow wrapper fails fast when act --list fails" {
  local shell_command
  shell_command="$(test_workflows_script_command)"

  run env PATH="$PATH" ACT_FULL=0 MOCK_ACT_LIST_EXIT=1 bash -lc "$shell_command"
  [ "$status" -eq 1 ]
  [[ "$output" == *"PASSED lint:workflows"* ]]
  [[ "$output" == *"FAILED act --list"* ]]
  [[ "$output" == *"SKIPPED test:workflows:fast"* ]]
  [[ "$output" == *"SKIPPED test:workflows"* ]]
  [[ "$output" != *"MOCK npm run test:workflows:fast"* ]]
  [[ "$output" != *$'MOCK npm run test:workflows\n'* ]]
}

@test "dry-run workflow wrapper runs the Docker suite when ACT_FULL=1" {
  local shell_command
  shell_command="$(test_workflows_script_command)"

  run env PATH="$PATH" ACT_FULL=1 bash -lc "$shell_command"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED test:workflows"* ]]
  [[ "$output" == *$'MOCK npm run test:workflows\n'* ]]
}

@test "dry-run workflow wrapper reports full suite failure when ACT_FULL=1" {
  local shell_command
  shell_command="$(test_workflows_script_command)"

  run env PATH="$PATH" ACT_FULL=1 MOCK_NPM_FULL_EXIT=1 bash -lc "$shell_command"
  [ "$status" -eq 1 ]
  [[ "$output" == *"PASSED lint:workflows"* ]]
  [[ "$output" == *"PASSED act --list"* ]]
  [[ "$output" == *"PASSED test:workflows:fast"* ]]
  [[ "$output" == *"FAILED test:workflows"* ]]
}

@test "dry-run workflow wrapper runs from outside the repository root" {
  local shell_command
  shell_command="$(test_workflows_script_command)"

  run env PATH="$PATH" ACT_FULL=0 ASSERT_REPO_ROOT=1 bash -lc "cd /tmp && $shell_command"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASSED lint:workflows"* ]]
  [[ "$output" == *"PASSED act --list"* ]]
  [[ "$output" == *"PASSED test:workflows:fast"* ]]
  [[ "$output" == *"SKIPPED test:workflows"* ]]
}

@test "check-user-allow exits 0 for OWNER" {
  require_docker
  run run_guard_in_docker "check-user-allow" ".github/workflows/test/fixtures/comment-owner.json"
  [ "$status" -eq 0 ]
}

@test "check-user-allow exits 0 for MEMBER" {
  require_docker
  run run_guard_in_docker "check-user-allow" ".github/workflows/test/fixtures/comment-member.json"
  [ "$status" -eq 0 ]
}

@test "check-user-allow exits 0 for COLLABORATOR" {
  require_docker
  run run_guard_in_docker "check-user-allow" ".github/workflows/test/fixtures/comment-collaborator.json"
  [ "$status" -eq 0 ]
}

@test "check-user-allow exits non-zero for CONTRIBUTOR" {
  require_docker
  run run_guard_in_docker "check-user-allow" ".github/workflows/test/fixtures/comment-contributor.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'does not allow COMMENT_AUTHOR_ASSOCIATION "CONTRIBUTOR"'* ]]
}

@test "check-user-allow exits non-zero for NONE" {
  require_docker
  run run_guard_in_docker "check-user-allow" ".github/workflows/test/fixtures/comment-none.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'does not allow COMMENT_AUTHOR_ASSOCIATION "NONE"'* ]]
}

@test "require-comment-prefix exits 0 for body starting with poe-code" {
  require_docker
  run run_guard_in_docker "require-comment-prefix" ".github/workflows/test/fixtures/comment-prefixed.json"
  [ "$status" -eq 0 ]
}

@test "require-comment-prefix exits 0 for body exactly poe-code" {
  require_docker
  run run_guard_in_docker "require-comment-prefix" ".github/workflows/test/fixtures/comment-prefix-only.json"
  [ "$status" -eq 0 ]
}

@test "require-comment-prefix exits non-zero for body with no prefix" {
  require_docker
  run run_guard_in_docker "require-comment-prefix" ".github/workflows/test/fixtures/comment-no-prefix.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'requires COMMENT_BODY to start with "poe-code"'* ]]
}

@test "require-comment-prefix exits non-zero for empty body" {
  require_docker
  run run_guard_in_docker "require-comment-prefix" ".github/workflows/test/fixtures/comment-empty.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'requires COMMENT_BODY to start with "poe-code"'* ]]
}

@test "require-comment-prefix exits non-zero for wrong case" {
  require_docker
  run run_guard_in_docker "require-comment-prefix" ".github/workflows/test/fixtures/comment-wrong-case.json"
  [ "$status" -ne 0 ]
  [[ "$output" == *'requires COMMENT_BODY to start with "poe-code"'* ]]
}
