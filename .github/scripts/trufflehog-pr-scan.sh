#!/usr/bin/env bash
set -euo pipefail

readonly results_file="${TRUFFLEHOG_RESULTS_FILE:-/tmp/trufflehog-results.jsonl}"
readonly stderr_file="${TRUFFLEHOG_STDERR_FILE:-/tmp/trufflehog-stderr.log}"
readonly comment_file="${TRUFFLEHOG_COMMENT_FILE:-/tmp/trufflehog-comment.md}"
readonly comment_marker="<!-- trufflehog-pr-scan -->"

require_env() {
  local name="$1"

  if [ -z "${!name:-}" ]; then
    echo "::error title=Missing environment variable::$name is required."
    exit 1
  fi
}

scan_for_secrets() {
  require_env BASE_SHA
  require_env HEAD_SHA
  require_env RESULTS
  require_env TRUFFLEHOG_IMAGE

  set +e
  docker run --rm -v "$PWD:/tmp" -w /tmp \
    "$TRUFFLEHOG_IMAGE" \
    git file:///tmp/ \
    --since-commit "$BASE_SHA" \
    --branch "$HEAD_SHA" \
    --fail \
    --no-update \
    --json \
    --results="$RESULTS" \
    > "$results_file" \
    2> "$stderr_file"
  local scan_status="$?"
  set -e

  cat "$stderr_file"

  local findings_count
  findings_count="$(
    jq -R -s '[split("\n")[] | fromjson? | select(.DetectorName != null)] | length' \
      "$results_file"
  )"

  echo "exit_code=$scan_status" >> "$GITHUB_OUTPUT"
  echo "findings_count=$findings_count" >> "$GITHUB_OUTPUT"

  if [ "$scan_status" -ne 0 ] && [ "$findings_count" -eq 0 ]; then
    echo "::error title=TruffleHog scan failed::TruffleHog exited with $scan_status without producing findings."
    exit "$scan_status"
  fi
}

render_findings_table() {
  jq -R -s -r \
    --arg repository "$REPOSITORY" \
    --arg head_sha "$HEAD_SHA" \
    --argjson max_findings "$MAX_FINDINGS" \
    '
    def md:
      tostring
      | gsub("\\|"; "\\|")
      | gsub("`"; "\u0027")
      | gsub("\r|\n"; " ");

    def status:
      if .Verified then
        "verified"
      elif ((.VerificationError // "") | length) > 0 then
        "unknown"
      else
        "unverified"
      end;

    def git_metadata:
      .SourceMetadata.Data.Git
      // .SourceMetadata.Git
      // .SourceMetadata.git
      // .SourceMetadata.data.git
      // {};

    def file_path:
      git_metadata.file
      // git_metadata.File
      // .SourceMetadata.Filesystem.file
      // .SourceMetadata.filesystem.file
      // "unknown";

    def line_number:
      git_metadata.line
      // git_metadata.Line
      // .SourceMetadata.Filesystem.line
      // .SourceMetadata.filesystem.line
      // 0;

    def location:
      (file_path | tostring) as $path
      | (line_number | tonumber? // 0) as $line
      | if $line > 0 and $path != "unknown" then
          "[\($path):\($line)](https://github.com/\($repository)/blob/\($head_sha)/\($path)#L\($line))"
        elif $path != "unknown" then
          "`\($path | md)`"
        else
          "unknown"
        end;

    [split("\n")[] | fromjson? | select(.DetectorName != null)]
    | unique_by([status, .DetectorName, file_path, line_number]) as $findings
    | ([
        "| Detector | Location | Verification |",
        "| --- | --- | --- |"
      ] + (
        $findings[:$max_findings]
        | map("| \(.DetectorName | md) | \(location) | \(status | md) |")
      ) + (
        if ($findings | length) > $max_findings then
          ["", "_Showing first \($max_findings) of \($findings | length) findings._"]
        else
          []
        end
      ))
    | .[]
  ' "$results_file"
}

emit_inline_annotations() {
  jq -R -s -r --argjson max_findings "$MAX_FINDINGS" '
    def command:
      tostring
      | gsub("%"; "%25")
      | gsub("\r"; "%0D")
      | gsub("\n"; "%0A")
      | gsub(":"; "%3A")
      | gsub(","; "%2C");

    def message:
      tostring
      | gsub("%"; "%25")
      | gsub("\r"; "%0D")
      | gsub("\n"; "%0A");

    def status:
      if .Verified then
        "verified"
      elif ((.VerificationError // "") | length) > 0 then
        "unknown"
      else
        "unverified"
      end;

    def git_metadata:
      .SourceMetadata.Data.Git
      // .SourceMetadata.Git
      // .SourceMetadata.git
      // .SourceMetadata.data.git
      // {};

    def file_path:
      git_metadata.file
      // git_metadata.File
      // .SourceMetadata.Filesystem.file
      // .SourceMetadata.filesystem.file
      // "";

    def line_number:
      git_metadata.line
      // git_metadata.Line
      // .SourceMetadata.Filesystem.line
      // .SourceMetadata.filesystem.line
      // 0;

    [split("\n")[] | fromjson? | select(.DetectorName != null)]
    | unique_by([status, .DetectorName, file_path, line_number])
    | .[:$max_findings][]
    | (file_path | tostring) as $path
    | (line_number | tonumber? // 0) as $line
    | select($path != "" and $line > 0)
    | "::error file=\($path | command),line=\($line),title=\("TruffleHog: \(.DetectorName)" | command)::\("Possible secret detected (\(status)). Remove it from the PR and rotate it if it was real." | message)"
  ' "$results_file"
}

rendered_findings_count() {
  jq -R -s '
    def status:
      if .Verified then
        "verified"
      elif ((.VerificationError // "") | length) > 0 then
        "unknown"
      else
        "unverified"
      end;

    def git_metadata:
      .SourceMetadata.Data.Git
      // .SourceMetadata.Git
      // .SourceMetadata.git
      // .SourceMetadata.data.git
      // {};

    def file_path:
      git_metadata.file
      // git_metadata.File
      // .SourceMetadata.Filesystem.file
      // .SourceMetadata.filesystem.file
      // "unknown";

    def line_number:
      git_metadata.line
      // git_metadata.Line
      // .SourceMetadata.Filesystem.line
      // .SourceMetadata.filesystem.line
      // 0;

    [split("\n")[] | fromjson? | select(.DetectorName != null)]
    | unique_by([status, .DetectorName, file_path, line_number])
    | length
  ' "$results_file"
}

find_existing_comment_id() {
  gh api "repos/$REPOSITORY/issues/$PR_NUMBER/comments" \
    --jq ".[] | select(.body | contains(\"$comment_marker\")) | .id" \
    | tail -n 1
}

report_advisory_result() {
  require_env GH_TOKEN
  require_env HEAD_SHA
  require_env MAX_FINDINGS
  require_env PR_NUMBER
  require_env REPOSITORY

  local findings_table
  findings_table="$(render_findings_table)"

  emit_inline_annotations

  local findings_count
  findings_count="$(rendered_findings_count)"

  local findings_heading
  local error_title
  local error_message
  if [ "$findings_count" -eq 1 ]; then
    findings_heading="TruffleHog found a possible secret"
    error_title="TruffleHog finding"
    error_message="Possible secret detected."
  else
    findings_heading="TruffleHog found $findings_count possible secrets"
    error_title="TruffleHog findings"
    error_message="Possible secrets detected."
  fi

  cat > "$comment_file" <<COMMENT
$comment_marker

### $findings_heading

$findings_table

Fix: remove the value, rotate it if it was real, and push a cleanup commit.
COMMENT

  local existing_comment_id
  existing_comment_id="$(find_existing_comment_id)"

  if [ -n "$existing_comment_id" ]; then
    gh api \
      --method PATCH \
      "repos/$REPOSITORY/issues/comments/$existing_comment_id" \
      --field body="$(cat "$comment_file")"
  else
    gh api \
      --method POST \
      "repos/$REPOSITORY/issues/$PR_NUMBER/comments" \
      --field body="$(cat "$comment_file")"
  fi

  echo "::error title=$error_title::$error_message"
  echo "### $findings_heading" >> "$GITHUB_STEP_SUMMARY"
  echo "" >> "$GITHUB_STEP_SUMMARY"
  printf '%s\n' "$findings_table" >> "$GITHUB_STEP_SUMMARY"
  echo "" >> "$GITHUB_STEP_SUMMARY"
  echo "Fix: remove the value, rotate it if it was real, and push a cleanup commit." >> "$GITHUB_STEP_SUMMARY"
}

clear_stale_advisory_result() {
  require_env GH_TOKEN
  require_env PR_NUMBER
  require_env REPOSITORY

  local existing_comment_id
  existing_comment_id="$(find_existing_comment_id)"

  if [ -n "$existing_comment_id" ]; then
    gh api \
      --method DELETE \
      "repos/$REPOSITORY/issues/comments/$existing_comment_id"
  fi
}

case "${1:-}" in
  scan-for-secrets)
    scan_for_secrets
    ;;
  report-advisory-result)
    report_advisory_result
    ;;
  clear-stale-advisory-result)
    clear_stale_advisory_result
    ;;
  *)
    echo "Usage: $0 {scan-for-secrets|report-advisory-result|clear-stale-advisory-result}" >&2
    exit 2
    ;;
esac
