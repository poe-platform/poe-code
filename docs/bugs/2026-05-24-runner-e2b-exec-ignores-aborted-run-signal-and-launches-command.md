# E2B exec ignores an aborted run signal and launches the command

## Summary

The shared `RunSpec` contract permits callers to provide an `AbortSignal` so execution can be cancelled before or during launch. Host and Docker runner implementations bind that signal to termination behavior. The E2B execution environment never reads `spec.signal`; even an already-aborted request still invokes the remote command API and returns its successful result.

## Reproduction

1. From the repository root, run this disposable probe. It passes an already-aborted signal to `env.exec()` while a mocked E2B sandbox records remote launches:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-abort-signal-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   let runCalls = 0;
   const sandbox = {
     sandboxId: "sb",
     commands: { run: async () => { runCalls += 1; return { pid: 12, wait: async () => ({ exitCode: 0 }), kill: async () => true }; }, list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
     files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
     pty: { create: async () => ({ pid: 13, wait: async () => ({ exitCode: 0 }), kill: async () => true }), sendInput: async () => {}, kill: async () => true },
     setTimeout: async () => {}, kill: async () => {}
   } as any;
   const env = createOpenedE2bEnv({
     sandbox,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   const controller = new AbortController();
   controller.abort();
   console.log("result=" + JSON.stringify(await env.exec({ command: "node", signal: controller.signal, stdout: "pipe", stderr: "pipe" }).result));
   console.log("runCalls=" + runCalls);
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The remote launch proceeds despite the command being cancelled before `exec()` is called:

```text
result={"exitCode":0}
runCalls=1
```

`RunSpec.signal` is part of the shared runner contract in `packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:26`. Host execution binds the signal in `packages/process-runner/src/host/host-runner.ts:44` through `packages/process-runner/src/host/host-runner.ts:86`, and Docker execution does likewise in `packages/process-runner/src/docker/docker-runner.ts:51` through `packages/process-runner/src/docker/docker-runner.ts:159`. In contrast, `packages/runner-e2b/src/opened-env.ts:138` through `packages/runner-e2b/src/opened-env.ts:145` and `packages/runner-e2b/src/opened-env.ts:194` through `packages/runner-e2b/src/opened-env.ts:280` never consult or register `spec.signal`.

## Expected Behavior

An already-aborted E2B execution request should not start a remote command, and an in-flight abort should trigger deterministic remote cancellation consistent with the shared runner contract.

## Impact

Cancelled or timed-out workflows can continue launching and running commands in E2B sandboxes after the caller has decided execution must not proceed, causing unobserved compute use and post-cancellation workspace mutations.
