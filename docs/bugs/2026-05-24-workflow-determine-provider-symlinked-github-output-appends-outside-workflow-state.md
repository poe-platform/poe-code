---
name: "Workflow determine-provider follows symlinked GitHub output file and appends outside workflow state"
---

# Workflow determine-provider follows symlinked GitHub output file and appends outside workflow state

## Summary

The `determine-provider` GitHub Actions helper appends provider resolution metadata to the `GITHUB_OUTPUT` path without rejecting symbolic links. A symlink used for that workflow output redirects generated values into an external file.

## Reproduction

1. From the repository root, run this disposable helper probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-determine-provider-output-probe.XXXXXX)
   printf 'EXTERNAL OUTPUT\n' > "$probe/outside-output.txt"
   ln -s "$probe/outside-output.txt" "$probe/github-output"

   GITHUB_OUTPUT="$probe/github-output" LABEL_NAME='agent:codex' ISSUE_NUMBER='27' ISSUE_LABELS='[]' \
     "$workspace/node_modules/.bin/tsx" scripts/workflows/determine-provider.ts

   realpath "$probe/github-output"
   cat "$probe/outside-output.txt"
   ```

## Observed Behavior

The output path resolves to the external file, which receives provider workflow state such as:

```text
EXTERNAL OUTPUT
service=codex
default_model=openai/gpt-5.5
```

`scripts/workflows/determine-provider.ts:72` through `scripts/workflows/determine-provider.ts:76` append values to `GITHUB_OUTPUT`, and `scripts/workflows/determine-provider.ts:104` through `scripts/workflows/determine-provider.ts:119` call that writer for provider output without validating the destination.

## Expected Behavior

The workflow helper should append output only to a validated regular file supplied by GitHub Actions, rejecting symbolic-link destinations.

## Impact

An unexpectedly replaced action-output path can redirect selected provider, model, and branch metadata into arbitrary user-writable files and disrupt automation that consumes those outputs.
