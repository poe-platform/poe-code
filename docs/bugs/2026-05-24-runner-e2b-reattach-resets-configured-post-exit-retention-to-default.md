# E2B reattach resets configured post-exit retention to the default duration

## Summary

An E2B runtime can configure `preserve_after_exit_hours` to control how long a detached sandbox remains available after its job exits. Detached job state does not persist that runtime setting, and `e2bExecutionEnvFactory.attach()` rebuilds the runtime with `preserve_after_exit_hours: 24`, so waiting on a reattached job extends retention using the default rather than the configured duration.

## Reproduction

1. From the repository root, run this disposable probe with a mock E2B sandbox that records timeout updates:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-preserve-wait-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const timeouts: number[] = [];
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { list: async () => [], run: async () => ({ exitCode: 0 }), connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async (filePath: string) => filePath.endsWith(".exit") ? "0\n" : new Uint8Array(), write: async () => {} },
     pty: { create: async () => ({ pid: 1, wait: async () => ({ exitCode: 0 }), kill: () => {} }) },
     setTimeout: async (ms: number) => { timeouts.push(ms); }, kill: async () => {}
   };
   const original = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 2 } as any,
     spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }, detachedJobId: "job" } as any
   });
   await original.job!.wait();
   const reattachedUsingFactoryRuntime = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }, detachedJobId: "job" } as any
   });
   await reattachedUsingFactoryRuntime.job!.wait();
   console.log(JSON.stringify(timeouts));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   nl -ba packages/runner-e2b/src/factory.ts | sed -n '39,67p'
   nl -ba packages/poe-code-config/src/state/jobs.ts | sed -n '7,19p'
   ```

## Observed Behavior

The same exited job applies a two-hour retention when constructed with its configured runtime, but a reattached-equivalent job applies 24 hours:

```text
[7200000,86400000]
```

`packages/runner-e2b/src/job-handle.ts:40` through `packages/runner-e2b/src/job-handle.ts:45` apply the retained duration on `wait()`. However, `packages/poe-code-config/src/state/jobs.ts:7` through `packages/poe-code-config/src/state/jobs.ts:19` persist no retention setting, and `packages/runner-e2b/src/factory.ts:39` through `packages/runner-e2b/src/factory.ts:67` reconstruct every attached runtime with `preserve_after_exit_hours: 24`.

## Expected Behavior

Detached E2B job state and reattachment should preserve the originally configured `preserve_after_exit_hours` value so later waits retain the sandbox for the intended duration.

## Impact

Sandboxes configured for shorter post-exit retention can be unintentionally kept alive for an additional day after reattachment, increasing remote resource retention and violating lifecycle expectations.
