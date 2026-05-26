# E2B run-handle kill rejections become unhandled process errors

## Summary

The E2B `RunHandle` implementations expose synchronous `kill()` methods but invoke asynchronous sandbox termination APIs without awaiting or catching rejected promises. When E2B fails to terminate a command or PTY session, the rejection escapes as an unhandled process-level error instead of being incorporated into controlled cancellation or shutdown behavior.

## Reproduction

1. From the repository root, run this disposable probe for an interactive E2B shell whose PTY termination request rejects:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-pty-kill-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   process.once("unhandledRejection", (error) => {
     console.log("unhandled=" + (error as Error).message);
   });
   const ptyHandle = { pid: 12, wait: async () => new Promise(() => {}), kill: async () => true };
   const sandbox = {
     sandboxId: "sb",
     commands: { run: async () => ({ pid: 11, wait: async () => ({ exitCode: 0 }), kill: async () => true }), list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
     files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
     pty: { create: async () => ptyHandle, sendInput: async () => {}, kill: async () => { throw new Error("pty kill failed"); } },
     setTimeout: async () => {}, kill: async () => {}
   } as any;
   const env = createOpenedE2bEnv({
     sandbox,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   const shell = env.shell();
   await new Promise((resolve) => setImmediate(resolve));
   shell.kill();
   await new Promise((resolve) => setImmediate(resolve));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Calling `kill()` produces an unhandled rejected promise from the E2B termination API:

```text
unhandled=pty kill failed
```

The non-interactive command handle has the same pattern: a rejected `e2bHandle.kill()` from `packages/runner-e2b/src/opened-env.ts:265` through `packages/runner-e2b/src/opened-env.ts:280` becomes an unhandled rejection. The interactive PTY path invokes `sandbox.pty.kill(...)` with `void` and no rejection handler in `packages/runner-e2b/src/opened-env.ts:325` through `packages/runner-e2b/src/opened-env.ts:336`. The shared `RunHandle.kill()` contract is synchronous in `packages/process-runner/src/types.ts:3` through `packages/process-runner/src/types.ts:10`, so backend implementations must explicitly contain asynchronous termination errors.

## Expected Behavior

E2B termination failures should be handled deterministically: either captured by an awaited cancellation path, reported through a controlled result/error channel, or intentionally suppressed without generating unhandled promise rejections.

## Impact

Cancellation, timeout handling, and interactive shell teardown can generate unhandled process errors or crash embedding applications precisely during recovery from remote E2B failures.
