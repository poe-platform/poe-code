# Runtime jobs log stream discards chunks that arrive after its poll timeout

## Summary

The runtime jobs log helper races every `iterator.next()` call against a fixed 250 ms timer. If a log read takes longer than that timer, the helper abandons the unresolved read and either exits immediately for `logs` or starts another read for `attach`. Any log chunk eventually produced by the timed-out request is never written to the user.

## Reproduction

1. From the repository root, run this disposable probe with a log iterator that yields one chunk after 350 ms, longer than the helper's 250 ms poll interval:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-logs-slow-read-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { streamJobLog } from "${workspace}/src/cli/commands/runtime/jobs/shared.ts";

   void (async () => {
     const output: string[] = [];
     let returned = false;
     const handle = {
       stream() {
         return {
           [Symbol.asyncIterator]() {
             return {
               async next() {
                 await new Promise((resolve) => setTimeout(resolve, 350));
                 return { done: false, value: { byteOffset: 0, data: "late-log" } };
               },
               async return() { returned = true; return { done: true, value: undefined }; }
             };
           }
         };
       }
     } as any;
     await streamJobLog(handle, { follow: false, write(chunk) { output.push(chunk); } });
     await new Promise((resolve) => setTimeout(resolve, 150));
     console.log(JSON.stringify({ output, returned }));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The late log chunk is never delivered even though the iterator eventually resolves it:

```text
{"output":[],"returned":true}
```

`runtime jobs logs` attaches to the job and delegates output to `streamJobLog(...)` in `src/cli/commands/runtime/jobs/logs.ts:25` through `src/cli/commands/runtime/jobs/logs.ts:38`; `runtime jobs attach` uses the same helper in `src/cli/commands/runtime/jobs/attach.ts:39` through `src/cli/commands/runtime/jobs/attach.ts:60`. The helper races `iterator.next()` against `sleep(250)` in `src/cli/commands/runtime/jobs/shared.ts:102` through `src/cli/commands/runtime/jobs/shared.ts:155`. For non-following reads it breaks immediately when the timer wins, invokes `iterator.return()`, and never observes or writes the outstanding `next()` result.

## Expected Behavior

Log reading should not discard a valid chunk merely because the backing runtime or file API needs more than 250 ms to respond. Non-following logs should wait for the requested read to settle, and following mode should preserve a single outstanding read rather than abandoning chunks between status polls.

## Impact

Users troubleshooting detached jobs can receive empty or incomplete log output whenever runtime latency exceeds a quarter second, making successful output indistinguishable from jobs that produced no logs and hiding diagnostics needed for recovery.
