---
name: "E2B interactive spawn ignores the configured agent command and arguments"
---

# E2B interactive spawn ignores the configured agent command and arguments

## Summary

Interactive agent spawning constructs a `shellSpec` containing the selected agent binary and its arguments, but the E2B shell adapter discards both values when it creates the remote PTY. E2B interactive runs therefore open the PTY service's default shell instead of launching the requested interactive agent command.

## Reproduction

1. From the repository root, run this disposable probe with a configured interactive command and a mocked E2B PTY that captures its creation options:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-shell-command-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";

   void (async () => {
     let createOptions: unknown;
     const ptyHandle = { pid: 17, wait: async () => ({ exitCode: 0 }), kill: async () => true };
     const sandbox = {
       sandboxId: "sb",
       commands: { list: async () => [], run: async () => ptyHandle, connect: async () => ptyHandle, sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
       files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
       pty: { create: async (opts: unknown) => { createOptions = opts; return ptyHandle; }, sendInput: async () => {}, kill: async () => true },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const env = createOpenedE2bEnv({
       sandbox,
       runtime: { type: "e2b", build_args: {}, mounts: [] } as any,
       spec: {
         cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "ignored", argv: [] },
         shellSpec: { command: "node", args: ["interactive-agent.js", "--chat"], cwd: "/repo", env: { MODE: "chat" } }
       } as any
     });
     await env.shell().result;
     console.log(JSON.stringify(createOptions));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The E2B PTY receives working-directory and environment configuration, but not the requested command or arguments:

```text
{"cols":80,"rows":24,"cwd":"/workspace","envs":{"MODE":"chat","HOME":"/home/user"}}
```

Interactive agent spawning records the requested binary and arguments in `shellSpec` in `packages/agent-spawn/src/spawn-interactive.ts:107` through `packages/agent-spawn/src/spawn-interactive.ts:127`. `createOpenedE2bEnv(...).shell()` reads those values and includes them in its `RunSpec` in `packages/runner-e2b/src/opened-env.ts:170` through `packages/runner-e2b/src/opened-env.ts:184`, but `runE2bPty()` only forwards terminal dimensions, cwd, envs, and output handling to `sandbox.pty.create(...)` in `packages/runner-e2b/src/opened-env.ts:297` through `packages/runner-e2b/src/opened-env.ts:308`. No remote command launch uses `spec.command` or `spec.args`.

## Expected Behavior

When interactive spawning requests an agent binary and arguments, the E2B runtime should launch that command attached to a PTY, matching host and Docker interactive runtimes rather than silently substituting a default remote shell.

## Impact

Interactive agent execution on the E2B runtime cannot run the selected agent or its prompt/session flags. Users requesting an interactive Codex, Claude, OpenCode, Goose, or similar E2B session instead receive a generic shell session, making the feature non-functional even before stdin handling is considered.
