---
name: "TruffleHog scan follows symlinked GitHub output file and appends outside workflow state"
---

# TruffleHog scan follows symlinked GitHub output file and appends outside workflow state

## Summary

The GitHub-workflows TruffleHog scan command appends result metadata to the `GITHUB_OUTPUT` path without rejecting symbolic links. A symlink supplied as that workflow output file redirects appended step output into an external file.

## Reproduction

1. From the repository root, run this disposable scan probe. It mocks Docker execution, so no container is started:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-trufflehog-github-output-probe.XXXXXX)
   printf 'EXTERNAL OUTPUT\n' > "$probe/outside-output.txt"
   ln -s "$probe/outside-output.txt" "$probe/github-output"
   cat > "$probe/repro.mts" <<EOF
   import { runTruffleHogPrScanCommand } from "${workspace}/packages/github-workflows/src/exec/trufflehog-pr-scan.ts";
   const env = new Map(Object.entries({
     BASE_SHA: "base", HEAD_SHA: "head", RESULTS: "verified,unknown,unverified", TRUFFLEHOG_IMAGE: "image",
     GITHUB_OUTPUT: "${probe}/github-output", TRUFFLEHOG_RESULTS_FILE: "${probe}/results.jsonl",
     TRUFFLEHOG_STDERR_FILE: "${probe}/stderr.log"
   }));
   const runner = async () => ({ exitCode: 0, stdout: "", stderr: "" });
   await runTruffleHogPrScanCommand("scan-for-secrets", {
     get: (key: string) => env.get(key)
   }, { cwd: "${probe}", runner: runner as any });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/github-output"
   cat "$probe/outside-output.txt"
   ```

## Observed Behavior

The output path resolves to the external file, which receives workflow key-value output:

```text
EXTERNAL OUTPUT
exit_code=0
findings_count=0
```

`packages/github-workflows/src/exec/trufflehog-pr-scan.ts:166` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:168` publish scan metadata, and `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:282` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:286` append to `GITHUB_OUTPUT` without validating the destination.

## Expected Behavior

Workflow output should only be appended to a validated regular file supplied by GitHub Actions, with symbolic-link destinations rejected.

## Impact

An untrusted or unexpectedly replaced output path can make secret-scanning workflow state write to arbitrary user-writable files, corrupting external data and diverting values meant for later workflow steps.
