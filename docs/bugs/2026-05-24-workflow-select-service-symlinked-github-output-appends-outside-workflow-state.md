# Workflow select-service follows symlinked GitHub output file and appends outside workflow state

## Summary

The `select-service` GitHub Actions helper appends its selected service metadata to the `GITHUB_OUTPUT` path without rejecting symbolic links. A symlink used for that workflow output redirects appended values into an external file.

## Reproduction

1. From the repository root, run this disposable helper probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-select-service-output-probe.XXXXXX)
   printf 'EXTERNAL OUTPUT\n' > "$probe/outside-output.txt"
   ln -s "$probe/outside-output.txt" "$probe/github-output"

   GITHUB_OUTPUT="$probe/github-output" \
     ISSUE_LABELS='[{"name":"agent:codex"}]' \
     node scripts/workflows/select-service.cjs

   realpath "$probe/github-output"
   cat "$probe/outside-output.txt"
   ```

## Observed Behavior

The output path resolves to the external file, which receives helper state such as:

```text
EXTERNAL OUTPUT
service=codex
default_service=claude-code
```

`scripts/workflows/select-service.cjs:5` accepts the workflow output path from the environment, and `scripts/workflows/select-service.cjs:43` appends derived outputs through it without validating the destination.

## Expected Behavior

The workflow helper should append output only to a validated regular file supplied by GitHub Actions, rejecting symbolic-link destinations.

## Impact

An unexpectedly replaced action-output path can redirect service-selection workflow state into arbitrary user-writable files and prevent intended values from reliably reaching later steps.
