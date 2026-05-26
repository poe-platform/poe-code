# TruffleHog advisory follows symlinked step summary file and appends outside workflow state

## Summary

The GitHub-workflows TruffleHog advisory command appends its findings table to the `GITHUB_STEP_SUMMARY` path without rejecting symbolic links. A symlink used for the workflow summary file redirects generated Markdown into an external document.

## Reproduction

1. From the repository root, run this disposable advisory probe. It mocks GitHub CLI calls, so GitHub is not contacted:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-trufflehog-summary-probe.XXXXXX)
   printf '{"DetectorName":"SummaryLeak","SourceMetadata":{"Data":{"Git":{"file":"src/secret.ts","line":9}}}}\n' \
     > "$probe/results.jsonl"
   printf 'EXTERNAL SUMMARY\n' > "$probe/outside-summary.md"
   ln -s "$probe/outside-summary.md" "$probe/github-summary"
   cat > "$probe/repro.mts" <<EOF
   import { runTruffleHogPrScanCommand } from "${workspace}/packages/github-workflows/src/exec/trufflehog-pr-scan.ts";
   const env = new Map(Object.entries({
     GH_TOKEN: "token", HEAD_SHA: "head", MAX_FINDINGS: "10", PR_NUMBER: "1", REPOSITORY: "org/repo",
     TRUFFLEHOG_RESULTS_FILE: "${probe}/results.jsonl", GITHUB_STEP_SUMMARY: "${probe}/github-summary"
   }));
   const runner = async (_cmd: string, args: string[]) => args.includes("--method")
     ? ({ exitCode: 0, stdout: "{}", stderr: "" })
     : ({ exitCode: 0, stdout: "[]", stderr: "" });
   await runTruffleHogPrScanCommand("report-advisory-result", {
     get: (key: string) => env.get(key)
   }, { runner: runner as any });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts" >/dev/null
   realpath "$probe/github-summary"
   cat "$probe/outside-summary.md"
   ```

## Observed Behavior

The summary path resolves to the external document, which receives the generated advisory Markdown:

```text
EXTERNAL SUMMARY
### TruffleHog found a possible secret
```

`packages/github-workflows/src/exec/trufflehog-pr-scan.ts:211` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:218` generate the summary, and `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:289` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:293` append to `GITHUB_STEP_SUMMARY` without validating the destination.

## Expected Behavior

Workflow summaries should only be appended to a validated regular file supplied by GitHub Actions, with symbolic-link destinations rejected.

## Impact

An untrusted or unexpectedly replaced summary path can cause secret-scanning workflow output to append findings and repository links into arbitrary user-writable files outside the intended workflow state.
