# E2B exec converts a sandbox API failure to agent exit code one

## Summary

The E2B execution environment runs non-interactive commands through `sandbox.commands.run(...).wait()`. If launching or waiting on that E2B command rejects for an infrastructure reason such as a transport outage, the adapter converts the rejection into a normal `{ exitCode: 1 }` command result instead of surfacing the runtime failure. Callers cannot distinguish an agent that exited with code `1` from a command that never successfully ran in the sandbox.

## Reproduction

1. From the repository root, run this disposable probe with a mocked sandbox whose command API is unavailable:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-exec-failure-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const sandbox = {
     sandboxId: "sb",
     commands: { run: async () => { throw new Error("sandbox transport offline"); }, list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
     files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
     pty: { create: async () => ({}), sendInput: async () => {}, kill: async () => true },
     setTimeout: async () => {}, kill: async () => {}
   } as any;
   const env = createOpenedE2bEnv({
     sandbox,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   console.log(JSON.stringify(await env.exec({ command: "node", args: ["task.js"], stdout: "pipe", stderr: "pipe" }).result));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The E2B API rejection is swallowed and returned as an ordinary process exit status:

```text
{"exitCode":1}
```

`packages/runner-e2b/src/opened-env.ts:194` through `packages/runner-e2b/src/opened-env.ts:263` construct the E2B process handle. Its result rejection handler returns a specific error exit code only for E2B exit errors, but converts every other rejected sandbox operation to `{ exitCode: 1 }` at `packages/runner-e2b/src/opened-env.ts:255` through `packages/runner-e2b/src/opened-env.ts:262`.

## Expected Behavior

Non-command infrastructure failures from the E2B API should reject the execution result with the underlying runtime error, while only genuine remote command termination should be represented as a process exit code.

## Impact

Agent execution, retries, and higher-level workflows can misdiagnose E2B outages as ordinary agent failures, discarding actionable runtime diagnostics and making recovery logic choose the wrong response.
