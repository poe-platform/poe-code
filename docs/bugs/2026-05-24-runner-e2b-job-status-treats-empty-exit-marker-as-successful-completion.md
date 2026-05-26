# E2B job status treats an empty exit marker as successful completion

## Summary

The E2B detached-job status path parses an empty exit-marker file as numeric exit code `0`, reporting the job as `exited`, while its wait path explicitly rejects the same empty marker as invalid. A partially written or corrupted empty marker therefore produces contradictory completion behavior and can be mistaken for successful execution.

## Reproduction

1. From the repository root, run this disposable probe with an E2B job whose `.exit` file exists but is empty:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-empty-exit-marker-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createE2bJobHandle } from "${workspace}/packages/runner-e2b/src/job-handle.ts";

   void (async () => {
     const sandbox = {
       sandboxId: "sb",
       commands: { list: async () => [], run: async () => ({ stdout: "0" }), connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
       files: { read: async () => "", write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
       pty: { create: async () => ({}), sendInput: async () => {}, kill: async () => true },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const job = createE2bJobHandle({ sandbox, envId: "sb", jobId: "job-empty", tool: "node", argv: ["node"], preserveAfterExitHours: 24 });
     console.log("status=" + await job.status());
     try {
       await job.wait();
     } catch (error) {
       console.log("wait=" + (error as Error).message);
     }
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The same empty exit marker is treated as completion by `status()` and invalid data by `wait()`:

```text
status=exited
wait=Invalid exit code in /tmp/poe-jobs/job-empty.exit: 
```

`createE2bJobHandle(...).status()` reports `exited` whenever `readExitCode()` returns a non-null integer in `packages/runner-e2b/src/job-handle.ts:24` through `packages/runner-e2b/src/job-handle.ts:35`. `readExitCode()` applies `Number(contents.trim())`, so an empty string becomes numeric zero in `packages/runner-e2b/src/job-handle.ts:113` through `packages/runner-e2b/src/job-handle.ts:120`. By contrast, the shared `waitForExit()` implementation rejects empty marker contents before returning a result in `packages/agent-harness-tools/src/log-stream.ts:79` through `packages/agent-harness-tools/src/log-stream.ts:98`.

## Expected Behavior

Empty or malformed exit-marker contents should be rejected consistently and must not cause `status()` to claim a completed job, especially not as an implicit successful zero exit.

## Impact

If an E2B exit marker is observed while empty due to interrupted writes, corruption, or remote file inconsistency, status listing and automation can treat an indeterminate job as completed while later wait/sync paths fail. This exposes false completion state and can conceal failed or incomplete remote work.
