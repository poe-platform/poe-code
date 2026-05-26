# E2B detached job status masks exit-marker read errors as lost jobs

## Summary

The E2B detached-job handle determines completed status by reading `/tmp/poe-jobs/<jobId>.exit`. Its helper catches every file-read exception and treats it as if no exit marker exists. If reading the exit marker fails because of a temporary E2B file API problem, and the completed process is no longer listed, `status()` reports `lost` instead of surfacing that completion state could not be determined.

## Reproduction

1. From the repository root, run this disposable probe. It models an already-finished E2B job whose exit marker cannot currently be read and whose process is no longer present in the running-process list:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-status-read-failure-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createE2bJobHandle } from "${workspace}/packages/runner-e2b/src/job-handle.ts";
   const sandbox = {
     files: { read: async () => { throw new Error("temporary file API outage"); } },
     commands: { list: async () => [], kill: async () => true },
     setTimeout: async () => {}
   } as any;
   const handle = createE2bJobHandle({
     sandbox, envId: "sb", jobId: "job-completed", tool: "node", argv: ["node"], preserveAfterExitHours: 24
   });
   console.log("status=" + await handle.status());
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The exit-marker read failure is hidden and the detached job is classified as lost:

```text
status=lost
```

`packages/runner-e2b/src/job-handle.ts:24` through `packages/runner-e2b/src/job-handle.ts:35` rely on `readExitCode()` before checking running processes. `packages/runner-e2b/src/job-handle.ts:113` through `packages/runner-e2b/src/job-handle.ts:120` catch all errors from `sandbox.files.read()` and return `null`, making unavailable, unauthorized, or transiently failed reads indistinguishable from a genuinely absent exit marker.

## Expected Behavior

E2B status checks should treat only a verified missing exit marker as absent. Other exit-marker read failures should be surfaced as status errors or an unknown/unreachable state rather than converted into `lost`.

## Impact

Temporary E2B file API failures can cause completed jobs to be reported and subsequently persisted as lost, hiding their exit outcome and preventing reliable detached-job reconciliation or recovery.
