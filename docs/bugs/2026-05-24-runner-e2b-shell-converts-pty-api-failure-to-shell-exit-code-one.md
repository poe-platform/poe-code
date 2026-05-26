# E2B shell converts a PTY API failure to shell exit code one

## Summary

The E2B execution environment opens interactive shells through the sandbox PTY API. If creating or waiting on that PTY rejects for an infrastructure reason, the adapter converts the rejection into a normal `{ exitCode: 1 }` shell result instead of reporting that the remote interactive session could not be opened.

## Reproduction

1. From the repository root, run this disposable probe with a mocked sandbox whose PTY service rejects shell creation:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-shell-failure-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const sandbox = {
     sandboxId: "sb",
     commands: { run: async () => ({}), list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
     files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
     pty: { create: async () => { throw new Error("pty service offline"); }, sendInput: async () => {}, kill: async () => true },
     setTimeout: async () => {}, kill: async () => {}
   } as any;
   const env = createOpenedE2bEnv({
     sandbox,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   console.log(JSON.stringify(await env.shell().result));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The failed PTY creation is presented as an ordinary shell exit result:

```text
{"exitCode":1}
```

`packages/runner-e2b/src/opened-env.ts:283` through `packages/runner-e2b/src/opened-env.ts:337` wrap E2B PTY creation and waiting. Its rejection handler discards the actual PTY error and returns `{ exitCode: 1 }` in `packages/runner-e2b/src/opened-env.ts:319` through `packages/runner-e2b/src/opened-env.ts:322`.

## Expected Behavior

If the E2B PTY API cannot create or maintain an interactive shell, `shell().result` should reject with the runtime failure rather than claiming that a remote shell process ran and exited with status `1`.

## Impact

Users invoking interactive E2B shells, including runtime sandbox debugging flows, receive misleading process-level failure results and lose diagnostics needed to determine whether the shell command failed or no session was established at all.
