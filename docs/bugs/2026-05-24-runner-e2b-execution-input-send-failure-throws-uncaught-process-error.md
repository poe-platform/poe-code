# E2B execution input send failure throws an uncaught process error

## Summary

When a command launched in E2B is given configured execution input and the remote `sendStdin(...)` API rejects, the error is emitted by the command's writable stdin stream and then thrown from the shared input helper's event listener. Instead of returning a controlled command/runtime failure, the failure escapes as an uncaught process-level exception.

## Reproduction

1. From the repository root, run this disposable probe with a mocked E2B command whose stdin delivery rejects:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-command-stdin-failure-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   import { runPoeCommand } from "${workspace}/packages/agent-harness-tools/src/run-poe-command.ts";

   void (async () => {
     process.once("uncaughtException", (error) => {
       console.log("uncaught=" + error.message);
       process.exitCode = 0;
     });
     const commandHandle = { pid: 21, wait: async () => new Promise(() => {}), kill: async () => true };
     const sandbox = {
       sandboxId: "sb",
       commands: { list: async () => [], run: async () => commandHandle, connect: async () => commandHandle, sendStdin: async () => { throw new Error("send stdin offline"); }, closeStdin: async () => {}, kill: async () => true },
       files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
       pty: { create: async () => commandHandle, sendInput: async () => {}, kill: async () => true },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const base = createOpenedE2bEnv({
       sandbox,
       runtime: { type: "e2b", build_args: {}, mounts: [] } as any,
       spec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "cat", argv: ["cat"] }, execution: { input: "hello", stdin: "pipe", wrapForLogTee: false } } as any
     });
     const env = { ...base, uploadWorkspace: async () => ({ files: 0, bytes: 0, skipped: [] }), close: async () => {} };
     const factory = { type: "e2b" as const, open: () => env, attach: async () => { throw new Error("unused"); } };
     const state = { jobs: { put: async () => {}, update: async () => {} } } as any;
     void runPoeCommand({ factory, state, detach: false, openSpec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "cat", argv: ["cat"] }, execution: { input: "hello", stdin: "pipe", wrapForLogTee: false } } as any });
     await new Promise((resolve) => setImmediate(resolve));
     await new Promise((resolve) => setImmediate(resolve));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The rejected E2B stdin delivery is raised as an uncaught exception in the calling process:

```text
uncaught=send stdin offline
```

The E2B adapter turns `sandbox.commands.sendStdin(...)` rejection into the `Writable` callback error in `packages/runner-e2b/src/opened-env.ts:220` through `packages/runner-e2b/src/opened-env.ts:242`. When `runPoeCommand()` writes configured input in `packages/agent-harness-tools/src/run-poe-command.ts:70` through `packages/agent-harness-tools/src/run-poe-command.ts:72`, its `writeExecutionInput()` listener throws every stdin error except `EPIPE` in `packages/agent-harness-tools/src/run-poe-command.ts:588` through `packages/agent-harness-tools/src/run-poe-command.ts:600`.

## Expected Behavior

Failure to deliver configured input to a running E2B command should reject the command operation or resolve it as a reported runtime failure through a controlled error path. It should not throw asynchronously from a stream event listener and crash or destabilize the host process.

## Impact

Transient E2B connectivity failures while sending prompt/input content can terminate CLI runs or embedding processes outside the normal command result flow, losing useful diagnostics and bypassing normal cleanup and state handling.
