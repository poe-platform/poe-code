# E2B reattach loses the configured sandbox workspace directory

## Summary

An E2B runtime may configure a sandbox-local `workspace_dir` other than `/workspace`, and initial upload/download operations use that directory. Detached job persistence does not store the configured workspace path, while `e2bExecutionEnvFactory.attach()` hard-codes `/workspace`, so later `runtime jobs sync`, attach-on-exit sync, or stop-and-sync operations read from the wrong sandbox directory.

## Reproduction

1. From the repository root, run this disposable probe. It uses a mock E2B sandbox that records remote archive commands:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-attach-workspace-probe.XXXXXX)
   mkdir -p "$probe/project"
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const commands: string[] = [];
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { run: async (command: string) => { commands.push(command); return { exitCode: 0 }; }, list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async () => new Uint8Array(), write: async () => {} },
     pty: { create: async () => ({ pid: 1, wait: async () => ({ exitCode: 0 }), kill: () => {} }) },
     setTimeout: async () => {}, kill: async () => {}
   };
   const opened = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/custom/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "${probe}/project", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   await opened.downloadWorkspace({ conflictPolicy: "overwrite" });
   const reattachedUsingFactoryRuntime = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "${probe}/project", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   await reattachedUsingFactoryRuntime.downloadWorkspace({ conflictPolicy: "overwrite" });
   console.log(commands.join("\n---\n"));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   nl -ba packages/runner-e2b/src/factory.ts | sed -n '39,67p'
   nl -ba packages/poe-code-config/src/state/jobs.ts | sed -n '7,19p'
   ```

## Observed Behavior

The initial runtime reads from its configured workspace, but the reattached-equivalent environment reads from the default directory:

```text
tar -cf /tmp/poe-workspace-download.tar -C '/custom/workspace' .
---
tar -cf /tmp/poe-workspace-download.tar -C '/workspace' .
```

`packages/runner-e2b/src/opened-env.ts:43` through `packages/runner-e2b/src/opened-env.ts:45` derive transfer paths from `runtime.workspace_dir`. However, `packages/poe-code-config/src/state/jobs.ts:7` through `packages/poe-code-config/src/state/jobs.ts:19` persist no runtime workspace path, `src/cli/commands/runtime/jobs/shared.ts:59` through `src/cli/commands/runtime/jobs/shared.ts:66` cannot pass one during reattachment, and `packages/runner-e2b/src/factory.ts:39` through `packages/runner-e2b/src/factory.ts:67` always reconstruct an attached runtime with `workspace_dir: "/workspace"`.

## Expected Behavior

Detached E2B job state must retain enough runtime context to reattach to the original configured `workspace_dir`, and later synchronization operations must use that same sandbox-local workspace path.

## Impact

Detached jobs configured to run outside `/workspace` can sync back stale, empty, or unrelated sandbox content while omitting the actual command outputs stored in the configured workspace directory.
