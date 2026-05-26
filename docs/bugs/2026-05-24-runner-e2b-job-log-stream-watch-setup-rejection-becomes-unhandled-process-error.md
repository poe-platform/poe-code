# E2B job log stream watch setup rejection becomes an unhandled process error

## Summary

E2B detached-job log streaming implements file watching by starting `sandbox.files.watchDir(...)` without awaiting or catching its promise. If E2B cannot create the remote watch subscription while a consumer waits for log output, the rejection escapes as an unhandled process-level error instead of being reported through the async log stream.

## Reproduction

1. From the repository root, run this disposable probe with a missing log file and a mocked remote watch API that rejects:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-log-watch-rejection-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createE2bJobHandle } from "${workspace}/packages/runner-e2b/src/job-handle.ts";

   void (async () => {
     process.once("unhandledRejection", (error) => {
       console.log("unhandled=" + (error as Error).message);
     });
     const sandbox = {
       sandboxId: "sb",
       commands: { list: async () => [], run: async () => ({ stdout: "1" }), connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
       files: {
         read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
         write: async () => {},
         watchDir: async () => { throw new Error("watch API offline"); }
       },
       pty: { create: async () => ({}), sendInput: async () => {}, kill: async () => true },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const job = createE2bJobHandle({ sandbox, envId: "sb", jobId: "job-1", tool: "node", argv: ["node"], preserveAfterExitHours: 24 });
     const pending = job.stream()[Symbol.asyncIterator]().next();
     await new Promise((resolve) => setImmediate(resolve));
     await new Promise((resolve) => setImmediate(resolve));
     void pending;
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The rejected remote watch setup becomes an unhandled rejection and terminates the process under current Node behavior:

```text
unhandled=watch API offline
Error: watch API offline
```

`createE2bJobHandle(...).stream()` delegates to shared log streaming in `packages/runner-e2b/src/job-handle.ts:19` through `packages/runner-e2b/src/job-handle.ts:40`. Once no current log bytes exist, the shared stream waits for a filesystem change in `packages/agent-harness-tools/src/log-stream.ts:39` through `packages/agent-harness-tools/src/log-stream.ts:60` and `packages/agent-harness-tools/src/log-stream.ts:147` through `packages/agent-harness-tools/src/log-stream.ts:158`. The E2B `watch()` implementation starts `sandbox.files.watchDir(...)` with `void` and only a fulfillment handler in `packages/runner-e2b/src/job-handle.ts:80` through `packages/runner-e2b/src/job-handle.ts:96`, leaving rejected subscription creation unobserved.

## Expected Behavior

If E2B cannot start log watching, the log stream should reject in a controlled manner or fall back to polling. A remote watch subscription failure should never become an unhandled rejection outside the consumer's async iterator flow.

## Impact

Watching logs from a detached E2B job can crash CLI commands or embedding processes during transient E2B file-watch failures, preventing users from diagnosing running jobs and bypassing normal error handling.
