# Poe command session reuses an environment after initial upload failure without retrying sync

## Summary

`createPoeCommandSession()` caches its opened execution environment before the initial workspace upload has succeeded. If that first upload rejects and the caller retries the session, `getEnv()` returns the cached environment immediately and does not attempt the failed upload again, allowing commands to execute against an unsynchronized or empty remote workspace.

## Reproduction

1. From the repository root, run this disposable probe with an environment whose first upload fails and whose second upload would succeed if retried:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-session-upload-retry-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { createPoeCommandSession } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   void (async () => {
     let uploads = 0;
     let execs = 0;
     const env = {
       id: "env-1", job: null,
       uploadWorkspace: async () => { uploads += 1; if (uploads === 1) throw new Error("upload offline"); return { files: 1, bytes: 1, skipped: [] }; },
       downloadWorkspace: async () => ({ files: 0, bytes: 0, conflicts: [] }),
       exec: () => { execs += 1; return { pid: 1, stdin: null, stdout: new PassThrough(), stderr: new PassThrough(), result: Promise.resolve({ exitCode: 0 }), kill() {} }; },
       detach: async () => { throw new Error("unused"); }, shell: () => { throw new Error("unused"); }, close: async () => {}
     } as any;
     const session = createPoeCommandSession({
       factory: { type: "docker", open: async () => env, attach: async () => { throw new Error("unused"); } } as any,
       state: { jobs: { put: async () => {}, update: async () => {} } } as any
     });
     const spec = { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }, execution: { wrapForLogTee: false } } as any;
     try { await session.run(spec); } catch (error) { console.log("first=" + (error as Error).message); }
     const second = await session.run(spec);
     console.log(JSON.stringify({ uploads, execs, secondExitCode: second.exitCode }));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The first call fails to upload, but the retry executes without making a second upload attempt:

```text
first=upload offline
{"uploads":1,"execs":1,"secondExitCode":0}
```

`createPoeCommandSession()` assigns `env` immediately after opening it in `packages/agent-harness-tools/src/run-poe-command.ts:144` through `packages/agent-harness-tools/src/run-poe-command.ts:156`, before awaiting `env.uploadWorkspace()`. After that upload rejects, subsequent `session.run()` calls hit `if (env !== null) return env;` and skip upload entirely. The session is used for repeated Ralph execution in `src/sdk/ralph.ts:64` through `src/sdk/ralph.ts:130`, so this behavior is reachable through SDK-driven multi-step runs.

## Expected Behavior

The session should cache an environment as ready for command execution only after its initial workspace upload succeeds. If initial synchronization fails, a later retry should retry upload or create a fresh environment before launching any command.

## Impact

A transient upload failure can cause later session iterations to run against stale, incomplete, or absent project files while appearing successful, corrupting multi-step agent workflows and making remote behavior diverge from the local workspace.
