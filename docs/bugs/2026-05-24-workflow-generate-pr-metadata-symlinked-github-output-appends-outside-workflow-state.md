# Workflow generate-pr-metadata follows symlinked GitHub output file and appends outside workflow state

## Summary

The `generate-pr-metadata` GitHub Actions helper appends generated pull-request title and body values to the `GITHUB_OUTPUT` path without rejecting symbolic links. A symlink used for that workflow output redirects generated Markdown into an external file.

## Reproduction

1. From the repository root, run this disposable probe. It places stub `git` and `npx` commands first on `PATH`, so no network or model request is made:

   ```sh
   probe=$(mktemp -d /tmp/poe-pr-metadata-output-probe.XXXXXX)
   mkdir -p "$probe/bin"
   printf 'EXTERNAL PR OUTPUT\n' > "$probe/outside-output.txt"
   ln -s "$probe/outside-output.txt" "$probe/github-output"
   cat > "$probe/bin/git" <<'EOF'
   #!/bin/sh
   case "$*" in
     'fetch origin main') exit 0 ;;
     'diff origin/main --stat') printf ' file.ts | 1 +\n' ;;
     'diff origin/main') printf '+ change\n' ;;
     *) exit 1 ;;
   esac
   EOF
   cat > "$probe/bin/npx" <<'EOF'
   #!/bin/sh
   printf '{"title":"Fix probe","body":"## Summary\\n- Probe body"}\n'
   EOF
   chmod +x "$probe/bin/git" "$probe/bin/npx"

   PATH="$probe/bin:$PATH" GITHUB_OUTPUT="$probe/github-output" ISSUE_NUMBER='9' ISSUE_TITLE='Probe' ISSUE_BODY='Body' \
     node scripts/workflows/generate-pr-metadata.cjs

   realpath "$probe/github-output"
   cat "$probe/outside-output.txt"
   ```

## Observed Behavior

The output path resolves to the external file, which receives generated pull-request metadata:

```text
EXTERNAL PR OUTPUT
title<<EOF
Fix probe
EOF
body<<EOF
## Summary
```

`scripts/workflows/generate-pr-metadata.cjs:105` through `scripts/workflows/generate-pr-metadata.cjs:109` accept the output path from the environment, and `scripts/workflows/generate-pr-metadata.cjs:162` through `scripts/workflows/generate-pr-metadata.cjs:169` append generated metadata through it without validating the destination.

## Expected Behavior

The workflow helper should append output only to a validated regular file supplied by GitHub Actions, rejecting symbolic-link destinations.

## Impact

An unexpectedly replaced action-output path can redirect generated pull-request title and body content into arbitrary user-writable files and interfere with automated PR creation.
