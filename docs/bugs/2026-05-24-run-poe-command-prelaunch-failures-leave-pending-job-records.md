# Command pre-launch failures leave pending job records behind

## Summary

`runPoeCommand()` persists a job record with `status: "pending"` before opening or uploading the execution environment, but it has no failure transition or cleanup when those pre-launch operations reject. A command that never starts therefore leaves a permanent pending runtime-job entry with no environment ID or start timestamp.

## Reproduction

1. From the repository root, run this disposable probe with one environment-open failure and one workspace-upload failure while recording job state writes:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-prelaunch-pending-job-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { runPoeCommand } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   type Job = Record<string, unknown> & { id: string };
   async function run(name: string, factory: any) {
     const jobs = new Map<string, Job>();
     const state = { jobs: {
       put: async (entry: Job) => { jobs.set(entry.id, { ...entry }); },
       update: async (id: string, patch: Record<string, unknown>) => { const current = jobs.get(id); if (current) jobs.set(id, { ...current, ...patch }); return jobs.get(id) ?? null; }
     } } as any;
     try {
       await runPoeCommand({ factory, openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }, execution: { wrapForLogTee: false } } as any, detach: false, state });
     } catch (error) {
       console.log(name + "=" + JSON.stringify({ error: (error as Error).message, job: [...jobs.values()][0] }));
     }
   }
   const baseEnv = { id: "env-1", job: null, uploadWorkspace: async () => ({ files: 0, bytes: 0, skipped: [] }), close: async () => {} };
   await run("open", { type: "docker", open: async () => { throw new Error("open failed"); }, attach: async () => { throw new Error("unused"); } });
   await run("upload", { type: "docker", open: async () => ({ ...baseEnv, uploadWorkspace: async () => { throw new Error("upload failed"); } }), attach: async () => { throw new Error("unused"); } });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Both commands fail before launching any command, but retain pending job records:

```text
open={"error":"open failed","job":{"env_id":"","env_kind":"docker","tool":"agent","argv":["agent"],"cwd":"/repo","started_at":"","status":"pending"}}
upload={"error":"upload failed","job":{"env_id":"","env_kind":"docker","tool":"agent","argv":["agent"],"cwd":"/repo","started_at":"","status":"pending"}}
```

`runPoeCommand()` writes the initial pending entry in `packages/agent-harness-tools/src/run-poe-command.ts:28` through `packages/agent-harness-tools/src/run-poe-command.ts:40`, then opens the environment and uploads the workspace in `packages/agent-harness-tools/src/run-poe-command.ts:42` through `packages/agent-harness-tools/src/run-poe-command.ts:53`. Its `finally` block only closes an already-opened environment in `packages/agent-harness-tools/src/run-poe-command.ts:119` through `packages/agent-harness-tools/src/run-poe-command.ts:123`; it never removes or transitions a pending record after pre-launch failure. The persistent state model explicitly exposes `pending` entries in `packages/poe-code-config/src/state/jobs.ts:5` through `packages/poe-code-config/src/state/jobs.ts:25`, and `runtime jobs ls` displays all stored entries in `src/cli/commands/runtime/jobs/ls.ts:18` through `src/cli/commands/runtime/jobs/ls.ts:36`.

## Expected Behavior

If environment creation or initial workspace upload fails before a command is launched, the provisional job record should either be removed or transitioned to a terminal failed/error state that accurately reports it never ran.

## Impact

Failed launch attempts permanently clutter runtime job listings with non-actionable pending records lacking a sandbox to attach to, obscuring real jobs and misrepresenting operations that never started.
