---
name: "Workflow discover-models follows symlinked GitHub output file and appends outside workflow state"
---

# Workflow discover-models follows symlinked GitHub output file and appends outside workflow state

## Summary

The model-discovery GitHub Actions helper appends actionable issue metadata to the `GITHUB_OUTPUT` path without rejecting symbolic links. A symlink used for that workflow output redirects its result state into an external file.

## Reproduction

1. From the repository root, run this disposable probe. It invokes the exported discovery function with local mocks, so no network or GitHub requests are made:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-discover-models-output-probe.XXXXXX)
   printf 'EXTERNAL OUTPUT\n' > "$probe/outside-output.txt"
   ln -s "$probe/outside-output.txt" "$probe/github-output"
   cat > "$probe/repro.mjs" <<EOF
   import { runDiscovery } from "${workspace}/scripts/workflows/discover-models.mjs";
   const env = { GITHUB_REPOSITORY: "org/repo", GITHUB_TOKEN: "token", GITHUB_OUTPUT: "${probe}/github-output" };
   const response = (payload) => ({ ok: true, status: 200, statusText: "OK", headers: { get: () => null }, json: async () => payload });
   const fetch = async () => response([]);
   await runDiscovery({
     env, fetch, execFileSync: () => "[]", readFileSync: () => "", readdirSync: () => [],
     statSync: () => ({ isDirectory: () => false }), log: () => {}, warn: () => {}
   });
   EOF

   node "$probe/repro.mjs"
   realpath "$probe/github-output"
   cat "$probe/outside-output.txt"
   ```

## Observed Behavior

The output path resolves to the external file, which receives model-discovery state:

```text
EXTERNAL OUTPUT
actionable_issue_numbers=[]
actionable_issue_count=0
```

`scripts/workflows/discover-models.mjs:300` passes `GITHUB_OUTPUT` to its output writer, and `scripts/workflows/discover-models.mjs:907` through `scripts/workflows/discover-models.mjs:917` append through that path without validating the destination.

## Expected Behavior

The workflow helper should append output only to a validated regular file supplied by GitHub Actions, rejecting symbolic-link destinations.

## Impact

An unexpectedly replaced action-output path can redirect model-discovery issue state into arbitrary user-writable files and corrupt or hide the values consumed by later workflow jobs.
