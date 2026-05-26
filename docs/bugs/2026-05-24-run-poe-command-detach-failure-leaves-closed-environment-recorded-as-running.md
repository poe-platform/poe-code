# Detach failure leaves a closed environment recorded as a running job

## Summary

When `runPoeCommand()` starts a detached run, it persists the job as `running` before asking the runtime to detach. If `env.detach()` rejects, the outer cleanup closes the environment but never corrects the stored job state. The failed detach therefore creates a running record pointing at an environment that was immediately closed.

## Reproduction

1. From the repository root, run this disposable probe with an environment that rejects detach and records whether cleanup closed it:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-detach-failure-state-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { runPoeCommand } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   void (async () => {
     let closed = false;
     let job: any;
     const env = {
       id: "env-1", job: null,
       uploadWorkspace: async () => ({ files: 0, bytes: 0, skipped: [] }),
       downloadWorkspace: async () => ({ files: 0, bytes: 0, conflicts: [] }),
       exec: () => ({ pid: 1, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(), result: new Promise(() => {}), kill() {} }),
       setDetachedJobContext() {},
       detach: async () => { throw new Error("detach failed"); },
       shell: () => { throw new Error("unused"); },
       close: async () => { closed = true; }
     } as any;
     const state = { jobs: {
       put: async (entry: any) => { job = { ...entry }; },
       update: async (_id: string, patch: any) => { job = { ...job, ...patch }; return job; }
     } } as any;
     try {
       await runPoeCommand({
         factory: { type: "docker", open: async () => env, attach: async () => { throw new Error("unused"); } } as any,
         openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }, execution: { wrapForLogTee: false } } as any,
         detach: true,
         state
       });
     } catch (error) {
       console.log(JSON.stringify({ error: (error as Error).message, closed, job }));
     }
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The detach request fails and cleanup closes the environment, but the persisted job remains running:

```text
{"error":"detach failed","closed":true,"job":{"env_id":"env-1","env_kind":"docker","tool":"agent","argv":["agent"],"cwd":"/repo","status":"running"}}
```

`runPoeCommand()` updates the entry to `running` before detachment in `packages/agent-harness-tools/src/run-poe-command.ts:74` through `packages/agent-harness-tools/src/run-poe-command.ts:87`. Only after `env.detach()` succeeds does it prevent cleanup and return the detached job in `packages/agent-harness-tools/src/run-poe-command.ts:88` through `packages/agent-harness-tools/src/run-poe-command.ts:89`. If detachment rejects, the `finally` path closes the environment in `packages/agent-harness-tools/src/run-poe-command.ts:119` through `packages/agent-harness-tools/src/run-poe-command.ts:123`, without transitioning the previously persisted running entry.

## Expected Behavior

If detachment fails, the attempted job should not remain listed as running after its environment is closed. It should transition to a failure/lost terminal state or be removed as an unsuccessful detached launch.

## Impact

Users receive a failed detach operation but retain a phantom running job in persistent state. Later `runtime jobs` operations may try to attach to, stop, or sync an environment that cleanup already destroyed, obscuring the original detach failure and polluting job management.
