---
name: "Workflow check-eligible-user follows symlinked GitHub output file and appends outside workflow state"
---

# Workflow check-eligible-user follows symlinked GitHub output file and appends outside workflow state

## Summary

The `check-eligible-user` GitHub Actions helper appends its authorization decision to the `GITHUB_OUTPUT` path without rejecting symbolic links. A symlink used for that workflow output redirects the result into an external file.

## Reproduction

1. From the repository root, run this disposable probe. It installs a local `fetch` mock so GitHub is not contacted:

   ```sh
   probe=$(mktemp -d /tmp/poe-check-eligible-output-probe.XXXXXX)
   printf 'EXTERNAL OUTPUT\n' > "$probe/outside-output.txt"
   ln -s "$probe/outside-output.txt" "$probe/github-output"
   cat > "$probe/mock-fetch.cjs" <<'EOF'
   global.fetch = async () => ({ status: 404, ok: false, statusText: 'Not Found', json: async () => ({}) });
   EOF

   GITHUB_OUTPUT="$probe/github-output" GITHUB_REPOSITORY='org/repo' GITHUB_TOKEN='token' USERNAME='outsider' \
     node --require "$probe/mock-fetch.cjs" scripts/workflows/check-eligible-user.cjs

   realpath "$probe/github-output"
   cat "$probe/outside-output.txt"
   ```

## Observed Behavior

The output path resolves to the external file, which receives the authorization state:

```text
EXTERNAL OUTPUT
allowed=false
```

`scripts/workflows/check-eligible-user.cjs:8` reads `GITHUB_OUTPUT`, and `scripts/workflows/check-eligible-user.cjs:14` through `scripts/workflows/check-eligible-user.cjs:27` append authorization results through it without validating the destination.

## Expected Behavior

The workflow helper should append output only to a validated regular file supplied by GitHub Actions, rejecting symbolic-link destinations.

## Impact

An unexpectedly replaced action-output path can redirect authorization workflow decisions into arbitrary user-writable files and interfere with access-gating logic in subsequent steps.
