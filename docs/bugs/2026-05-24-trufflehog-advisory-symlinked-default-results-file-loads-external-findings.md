---
name: "TruffleHog advisory follows symlinked default results file and loads external findings"
---

# TruffleHog advisory follows symlinked default results file and loads external findings

## Summary

The GitHub-workflows TruffleHog advisory command reads scan findings from a predictable default file in `/tmp` without rejecting symbolic links. A symlink placed at that path makes the command load external JSONL and publish annotations and advisory content derived from it.

## Reproduction

1. From the repository root, run this disposable advisory probe. It mocks GitHub CLI calls, so GitHub is not contacted:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-trufflehog-read-probe.XXXXXX)
   printf '{"DetectorName":"External","SourceMetadata":{"Data":{"Git":{"file":"external.txt","line":7}}}}\n' \
     > "$probe/outside-results.jsonl"
   rm -f /tmp/trufflehog-results.jsonl
   ln -s "$probe/outside-results.jsonl" /tmp/trufflehog-results.jsonl
   cat > "$probe/repro.mts" <<EOF
   import { runTruffleHogPrScanCommand } from "${workspace}/packages/github-workflows/src/exec/trufflehog-pr-scan.ts";
   const env = new Map(Object.entries({
     GH_TOKEN: "token", HEAD_SHA: "head", MAX_FINDINGS: "10", PR_NUMBER: "1", REPOSITORY: "org/repo"
   }));
   const runner = async (_cmd: string, args: string[]) => args.includes("--method")
     ? ({ exitCode: 0, stdout: "{}", stderr: "" })
     : ({ exitCode: 0, stdout: "[]", stderr: "" });
   await runTruffleHogPrScanCommand("report-advisory-result", {
     get: (key: string) => env.get(key)
   }, { runner: runner as any });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath /tmp/trufflehog-results.jsonl
   rm -f /tmp/trufflehog-results.jsonl
   ```

## Observed Behavior

The default results path resolves to the external file, and the command prints an annotation based on the external JSONL finding:

```text
::error file=external.txt,line=7,title=TruffleHog%3A External::Possible secret detected (unverified). Remove it from the PR and rotate it if it was real.
```

`packages/github-workflows/src/exec/trufflehog-pr-scan.ts:6` defines the predictable default path, and `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:181` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:185` read and emit findings through that path without symlink checks.

## Expected Behavior

The advisory command should read scanner results only from validated workflow-owned storage, or reject symbolic-link inputs before using the findings.

## Impact

Another local process or stale temporary symlink can inject arbitrary findings into workflow annotations, pull-request advisory comments, and step summaries, misleading maintainers and exposing data from an unintended file.
