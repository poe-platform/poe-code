# Wrapped inactivity timeout with a signal returns a normal exit result

## Summary

When a wrapped synchronous command receives both an inactivity timeout and an `AbortSignal` object, timeout handling kills the process but the wrapped exit-file wait path does not report an `ActivityTimeoutError`. If the killed process handle resolves, `runPoeCommand()` returns its termination exit code as an ordinary completed run, concealing that the execution was forcibly stopped for inactivity.

## Reproduction

1. From the repository root, run this disposable probe with a wrapped command, an unused live abort signal, and a process handle that resolves after timeout termination:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-wrapped-timeout-with-signal-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { runPoeCommand } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   void (async () => {
     let killCalls = 0;
     const env = {
       id: "env", job: null,
       fs: { promises: { readFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } } },
       uploadWorkspace: async () => ({ files: 0, bytes: 0, skipped: [] }),
       downloadWorkspace: async () => ({ files: 0, bytes: 0, conflicts: [] }),
       exec: () => ({ pid: 12, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(), result: Promise.resolve({ exitCode: 143 }), kill: () => { killCalls += 1; } }),
       detach: async () => { throw new Error("unused"); }, shell: () => { throw new Error("unused"); }, close: async () => {}
     } as any;
     const controller = new AbortController();
     const state = { jobs: { put: async () => {}, update: async () => {} } } as any;
     try {
       const result = await runPoeCommand({
         factory: { type: "docker", open: () => env, attach: async () => { throw new Error("unused"); } } as any,
         openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }, execution: { activityTimeoutMs: 1 } } as any,
         detach: false, state, signal: controller.signal
       });
       console.log(JSON.stringify({ killCalls, result }));
     } catch (error) {
       console.log(JSON.stringify({ killCalls, error: { name: (error as Error).name, message: (error as Error).message } }));
     }
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The timeout sends termination but is returned as a normal synchronous command result:

```text
{"killCalls":1,"result":{"kind":"sync","exitCode":143,"download":{"files":0,"bytes":0,"conflicts":[]}}}
```

Wrapped execution uses `abort.waitForExit(...)` in `packages/agent-harness-tools/src/run-poe-command.ts:355` through `packages/agent-harness-tools/src/run-poe-command.ts:390`. The inactivity timer marks `timedOut` and kills the handle in `packages/agent-harness-tools/src/run-poe-command.ts:459` through `packages/agent-harness-tools/src/run-poe-command.ts:477`. With a signal object present, the timeout resolves `abortedPromise`, and the `waitForExit()` abort branch returns `handle.result` directly in `packages/agent-harness-tools/src/run-poe-command.ts:514` through `packages/agent-harness-tools/src/run-poe-command.ts:544`, without checking `timedOut` or raising `createActivityTimeoutError(...)` as the non-wrapped `waitForHandle()` path does.

## Expected Behavior

An inactivity timeout should reject with `ActivityTimeoutError` consistently for wrapped and unwrapped commands, regardless of whether the caller also supplied an `AbortSignal` object.

## Impact

Autonomous and pipeline executions may misclassify inactivity timeouts as ordinary agent process failures or termination exits, preventing timeout-specific retry/recovery logic and concealing why the run was killed.
