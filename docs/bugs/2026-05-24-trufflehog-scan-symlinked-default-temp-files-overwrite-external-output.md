# TruffleHog scan follows symlinked default temporary files and overwrites external output

## Summary

The GitHub-workflows TruffleHog scan command writes scanner results and stderr to predictable default files in `/tmp` without rejecting symbolic links. Symlinks placed at those fixed paths redirect scan output into external files.

## Reproduction

1. From the repository root, run this disposable scan probe. It supplies a local mock command runner, so Docker and GitHub are not contacted:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-trufflehog-output-probe.XXXXXX)
   printf 'ORIGINAL RESULTS\n' > "$probe/outside-results.jsonl"
   printf 'ORIGINAL STDERR\n' > "$probe/outside-stderr.log"
   rm -f /tmp/trufflehog-results.jsonl /tmp/trufflehog-stderr.log
   ln -s "$probe/outside-results.jsonl" /tmp/trufflehog-results.jsonl
   ln -s "$probe/outside-stderr.log" /tmp/trufflehog-stderr.log
   cat > "$probe/repro.mts" <<EOF
   import { runTruffleHogPrScanCommand } from "${workspace}/packages/github-workflows/src/exec/trufflehog-pr-scan.ts";
   const env = new Map(Object.entries({
     BASE_SHA: "base", HEAD_SHA: "head", RESULTS: "result", TRUFFLEHOG_IMAGE: "image"
   }));
   const runner = async () => ({
     exitCode: 0,
     stdout: '{"DetectorName":"Probe","SourceMetadata":{"Data":{"Git":{"file":"secret.txt","line":1}}}}\\n',
     stderr: "scanner stderr"
   });
   await runTruffleHogPrScanCommand("scan-for-secrets", {
     get: (key: string) => env.get(key)
   }, { cwd: "${probe}", runner: runner as any });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath /tmp/trufflehog-results.jsonl
   realpath /tmp/trufflehog-stderr.log
   cat "$probe/outside-results.jsonl"
   cat "$probe/outside-stderr.log"
   rm -f /tmp/trufflehog-results.jsonl /tmp/trufflehog-stderr.log
   ```

## Observed Behavior

The default results and stderr paths resolve to the external files, and executing the scan command overwrites them with scanner JSONL output and stderr text.

`packages/github-workflows/src/exec/trufflehog-pr-scan.ts:6` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:7` define predictable shared defaults, and `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:130` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:173` write scan results and stderr through those paths without exclusive temporary allocation or symlink checks.

## Expected Behavior

Secret-scan output should use exclusive, safe temporary storage or reject symbolic-link destinations before writing scanner artifacts.

## Impact

Another local process or stale temporary symlink can cause automated secret scanning to overwrite arbitrary user-writable files with potentially sensitive scanner results or diagnostic output.
