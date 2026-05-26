# E2B job log stream watch stop rejection becomes an unhandled process error

## Summary

After E2B detached-job log streaming successfully creates a remote file-watch subscription, it closes that subscription by invoking `handle.stop()` without awaiting or catching the returned promise. If cleanup of an otherwise successful watch fails, the error escapes as an unhandled process-level rejection.

## Reproduction

1. From the repository root, run this disposable probe. The mock successfully creates a watch, triggers a log-change notification so the shared stream closes it, and then rejects only the remote `stop()` cleanup operation:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-log-watch-stop-rejection-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createE2bJobHandle } from "${workspace}/packages/runner-e2b/src/job-handle.ts";

   void (async () => {
     process.once("unhandledRejection", (error) => {
       console.log("unhandled=" + (error as Error).message);
       process.exit(0);
     });
     const sandbox = {
       sandboxId: "sb",
       commands: { list: async () => [], run: async () => ({ stdout: "1" }), connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
       files: {
         read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
         write: async () => {},
         watchDir: async (_path: string, listener: () => void) => {
           setImmediate(listener);
           return { stop: async () => { throw new Error("stop API offline"); } };
         }
       },
       pty: { create: async () => ({}), sendInput: async () => {}, kill: async () => true },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const job = createE2bJobHandle({ sandbox, envId: "sb", jobId: "job-1", tool: "node", argv: ["node"], preserveAfterExitHours: 24 });
     void job.stream()[Symbol.asyncIterator]().next();
     setTimeout(() => { console.log("no-unhandled"); process.exit(0); }, 500);
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Cleaning up a successfully established log watch generates an unhandled rejection:

```text
unhandled=stop API offline
```

The shared log stream closes its watcher after a file-change notification or poll timeout in `packages/agent-harness-tools/src/log-stream.ts:147` through `packages/agent-harness-tools/src/log-stream.ts:169`. The E2B watcher adapter implements that close by calling asynchronous `handle.stop()` with `void` and no rejection handling in `packages/runner-e2b/src/job-handle.ts:80` through `packages/runner-e2b/src/job-handle.ts:100`; it has the same unobserved cleanup call if the watcher is closed before subscription setup resolves.

## Expected Behavior

Failure to stop an E2B log-watch subscription should be contained or propagated through the active stream operation without producing an unhandled rejection during routine cleanup.

## Impact

Log tailing can crash CLI commands or embedding processes even when reading logs and establishing the E2B watcher succeeded, solely because releasing the remote watch resource failed during normal stream polling or disposal.
