# Wrapped command abort returns a normal exit result

## Summary

When a synchronous command is wrapped for log/exit-file tracking and its abort signal is already aborted or fires during execution, the shared command runner kills the process but returns the killed handle's exit result as an ordinary completed run. This differs from unwrapped execution, which rejects cancellation with `AbortError`.

## Reproduction

1. From the repository root, run this disposable probe with an already-aborted signal and a wrapped process handle that resolves after termination:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-wrapped-abort-normal-exit-probe.XXXXXX)
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
     controller.abort();
     try {
       const result = await runPoeCommand({
         factory: { type: "docker", open: () => env, attach: async () => { throw new Error("unused"); } } as any,
         openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] } } as any,
         detach: false,
         state: { jobs: { put: async () => {}, update: async () => {} } } as any,
         signal: controller.signal
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

The aborted wrapped command is killed, but its terminated exit code is returned as a normal successful orchestration response:

```text
{"killCalls":1,"result":{"kind":"sync","exitCode":143,"download":{"files":0,"bytes":0,"conflicts":[]}}}
```

Wrapped synchronous runs use `abort.waitForExit(...)` in `packages/agent-harness-tools/src/run-poe-command.ts:355` through `packages/agent-harness-tools/src/run-poe-command.ts:390`. `createAbortSync()` detects an already-aborted signal and invokes `kill()` in `packages/agent-harness-tools/src/run-poe-command.ts:497` through `packages/agent-harness-tools/src/run-poe-command.ts:512`, but its wrapped `waitForExit()` returns `handle.result` whenever `aborted` is true in `packages/agent-harness-tools/src/run-poe-command.ts:514` through `packages/agent-harness-tools/src/run-poe-command.ts:540`. The unwrapped `waitForHandle()` path instead raises `createAbortError()` after cancellation in `packages/agent-harness-tools/src/run-poe-command.ts:542` through `packages/agent-harness-tools/src/run-poe-command.ts:560`.

## Expected Behavior

Aborted commands should reject with `AbortError` consistently, regardless of whether log/exit-file wrapping is enabled. A killed cancellation path should not be reported as an ordinary agent exit.

## Impact

Callers cannot reliably distinguish cancelled wrapped executions from genuine process failures or exits. User cancellation and higher-level abort orchestration can therefore appear to complete normally, leading to incorrect status, retry, or error-reporting behavior.
