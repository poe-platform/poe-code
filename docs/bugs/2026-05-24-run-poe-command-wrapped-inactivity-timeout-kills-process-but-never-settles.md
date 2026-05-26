# Wrapped command inactivity timeout kills the process but never settles

## Summary

Synchronous commands wrapped for log/exit-file tracking use exit-marker polling instead of waiting for the underlying process handle. When an activity timeout is configured without an external `AbortSignal`, the timeout handler sends `SIGTERM` but does not interrupt the exit-marker poll or raise the timeout error. If termination occurs before the wrapper writes its exit marker, the command promise remains pending indefinitely after the timeout fires.

## Reproduction

1. From the repository root, run this disposable probe with a wrapped command handle that records kills but never produces an exit marker:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-wrapped-timeout-hang-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { runPoeCommand } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   void (async () => {
     let killCalls = 0;
     const never = new Promise<{ exitCode: number }>(() => {});
     const env = {
       id: "env", job: null,
       fs: { promises: { readFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } } },
       uploadWorkspace: async () => ({ files: 0, bytes: 0, skipped: [] }),
       downloadWorkspace: async () => ({ files: 0, bytes: 0, conflicts: [] }),
       exec: () => ({ pid: 12, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(), result: never, kill: () => { killCalls += 1; } }),
       detach: async () => { throw new Error("unused"); }, shell: () => { throw new Error("unused"); }, close: async () => {}
     } as any;
     const state = { jobs: { put: async () => {}, update: async () => {} } } as any;
     let settled = false;
     void runPoeCommand({
       factory: { type: "docker", open: () => env, attach: async () => { throw new Error("unused"); } } as any,
       openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }, execution: { activityTimeoutMs: 1 } } as any,
       detach: false,
       state
     }).then(() => { settled = true; }, () => { settled = true; });
     await new Promise((resolve) => setTimeout(resolve, 40));
     console.log(JSON.stringify({ killCalls, settled }));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The timeout kills the command once, but the `runPoeCommand()` promise is still pending well after the configured timeout:

```text
{"killCalls":1,"settled":false}
```

`runSync()` waits on `abort.waitForExit(...)` for wrapped commands in `packages/agent-harness-tools/src/run-poe-command.ts:355` through `packages/agent-harness-tools/src/run-poe-command.ts:390`. The timeout callback sets `timedOut` and calls `handle.kill("SIGTERM")` in `packages/agent-harness-tools/src/run-poe-command.ts:459` through `packages/agent-harness-tools/src/run-poe-command.ts:477`. However, when no external signal exists, its `waitForExit()` implementation directly delegates to unbounded exit-marker polling in `packages/agent-harness-tools/src/run-poe-command.ts:480` through `packages/agent-harness-tools/src/run-poe-command.ts:494`; it does not race the timeout or pass an abort controller into `waitForExit()`.

## Expected Behavior

An inactivity timeout should cause a wrapped synchronous run to reject promptly with the timeout error after requesting termination, even if no exit-marker file is written during forced shutdown.

## Impact

Autonomous and pipeline command runs configured with inactivity timeouts can hang forever after a stalled process is killed, leaving job state unresolved and defeating the timeout intended to recover from silent agents or broken wrappers.
