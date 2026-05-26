# Command post-launch failures leave jobs recorded as running

## Summary

After `runPoeCommand()` has launched a command, it persists `status: "running"`, but it updates the record to a terminal state only after execution and workspace download both succeed. If the executed process rejects or completed output cannot be downloaded, the call fails while the stored job remains running even though the synchronous environment is closed and no resumable detached job exists.

## Reproduction

1. From the repository root, run this disposable probe with one command-result rejection and one post-completion download failure while recording job state writes:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-postlaunch-running-job-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { runPoeCommand } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   type Job = Record<string, unknown> & { id: string };
   async function run(name: string, changes: Record<string, unknown>) {
     const jobs = new Map<string, Job>();
     const state = { jobs: {
       put: async (entry: Job) => { jobs.set(entry.id, { ...entry }); },
       update: async (id: string, patch: Record<string, unknown>) => { const current = jobs.get(id); if (current) jobs.set(id, { ...current, ...patch }); return jobs.get(id) ?? null; }
     } } as any;
     const env = {
       id: "env-1", job: null,
       uploadWorkspace: async () => ({ files: 0, bytes: 0, skipped: [] }),
       downloadWorkspace: async () => ({ files: 0, bytes: 0, conflicts: [] }),
       exec: () => ({ pid: 1, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(), result: Promise.resolve({ exitCode: 0 }), kill() {} }),
       detach: async () => { throw new Error("unused"); }, shell: () => { throw new Error("unused"); }, close: async () => {},
       ...changes
     } as any;
     try {
       await runPoeCommand({ factory: { type: "docker", open: async () => env, attach: async () => { throw new Error("unused"); } } as any, openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }, execution: { wrapForLogTee: false } } as any, detach: false, state });
     } catch (error) {
       console.log(name + "=" + JSON.stringify({ error: (error as Error).message, job: [...jobs.values()][0] }));
     }
   }
   await run("execute", { exec: () => ({ pid: 1, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(), result: Promise.reject(new Error("exec failed")), kill() {} }) });
   await run("download", { downloadWorkspace: async () => { throw new Error("download failed"); } });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Both failed synchronous operations remain stored as actively running jobs:

```text
execute={"error":"exec failed","job":{"env_id":"env-1","env_kind":"docker","tool":"agent","argv":["agent"],"cwd":"/repo","status":"running"}}
download={"error":"download failed","job":{"env_id":"env-1","env_kind":"docker","tool":"agent","argv":["agent"],"cwd":"/repo","status":"running"}}
```

`runPoeCommand()` creates the `running` transition immediately after launch in `packages/agent-harness-tools/src/run-poe-command.ts:74` through `packages/agent-harness-tools/src/run-poe-command.ts:78`, then waits for execution and download in `packages/agent-harness-tools/src/run-poe-command.ts:92` through `packages/agent-harness-tools/src/run-poe-command.ts:107` and `packages/agent-harness-tools/src/run-poe-command.ts:355` through `packages/agent-harness-tools/src/run-poe-command.ts:390`. The terminal `exited` update occurs only after `runSync()` returns successfully. When either process waiting or download rejects, the outer `finally` closes the synchronous environment but performs no state correction in `packages/agent-harness-tools/src/run-poe-command.ts:119` through `packages/agent-harness-tools/src/run-poe-command.ts:123`.

## Expected Behavior

If a launched synchronous command or its required post-run synchronization fails, the stored job should transition out of `running` into an accurate terminal failed/lost/error state, preserving any available exit outcome rather than claiming active execution continues.

## Impact

Runtime job listings and later reconciliation operate on phantom running entries for synchronous runs that have already failed and been closed. Users may attempt to attach, stop, or sync environments that no longer represent an active detached job, while the original execution error is no longer reflected in persisted state.
