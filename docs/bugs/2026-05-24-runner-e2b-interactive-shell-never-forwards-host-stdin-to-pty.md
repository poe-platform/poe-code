# E2B interactive shell never forwards host stdin to the remote PTY

## Summary

The E2B execution environment advertises an interactive shell with inherited stdin, but it returns the local `process.stdin` object without connecting incoming data to `sandbox.pty.sendInput(...)`. As a result, keyboard or piped input sent to an E2B shell never reaches the remote shell process.

## Reproduction

1. From the repository root, run this disposable probe with a mocked E2B PTY that records all remote input:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-shell-input-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";

   void (async () => {
     const calls: Array<{ pid: number; data: string }> = [];
     const ptyHandle = { pid: 17, wait: async () => ({ exitCode: 0 }), kill: async () => true };
     const sandbox = {
       sandboxId: "sb",
       commands: { run: async () => ptyHandle, list: async () => [], connect: async () => ptyHandle, sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => true },
       files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
       pty: {
         create: async () => ptyHandle,
         sendInput: async (pid: number, data: Uint8Array) => calls.push({ pid, data: Buffer.from(data).toString("utf8") }),
         kill: async () => true
       },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const env = createOpenedE2bEnv({
       sandbox,
       runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
       spec: { cwd: "/repo", runtime: { type: "e2b" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "sh", argv: ["sh"] } } as any
     });
     const listenersBefore = process.stdin.listenerCount("data");
     const shell = env.shell();
     await new Promise((resolve) => setImmediate(resolve));
     const listenersAfter = process.stdin.listenerCount("data");
     process.stdin.emit("data", Buffer.from("hello\\n"));
     await new Promise((resolve) => setImmediate(resolve));
     console.log(JSON.stringify({ returnedHostStdin: shell.stdin === process.stdin, listenersBefore, listenersAfter, sendInputCalls: calls }));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The shell handle claims inherited stdin, but receiving local stdin data makes no E2B PTY input call:

```text
{"returnedHostStdin":true,"listenersBefore":0,"listenersAfter":0,"sendInputCalls":[]}
```

`createOpenedE2bEnv(...).shell()` requests `stdin: "inherit"` in `packages/runner-e2b/src/opened-env.ts:170` through `packages/runner-e2b/src/opened-env.ts:184`. `runE2bPty()` creates a forwarding writable stream in `packages/runner-e2b/src/opened-env.ts:286` through `packages/runner-e2b/src/opened-env.ts:296`, but returns `process.stdin` instead of that stream whenever stdin is inherited in `packages/runner-e2b/src/opened-env.ts:325` through `packages/runner-e2b/src/opened-env.ts:334`. No pipe or input listener connects `process.stdin` to the forwarding stream. The user-facing `runtime jobs sandbox --runtime e2b` command calls this shell path in `src/cli/commands/runtime/jobs/sandbox.ts:15` through `src/cli/commands/runtime/jobs/sandbox.ts:19`.

## Expected Behavior

Interactive E2B shells should forward data read from inherited host stdin to `sandbox.pty.sendInput(...)`, so typing or piping input controls the remote PTY in the same way inherited stdin controls host and Docker interactive shells.

## Impact

Users can open an E2B sandbox shell and view output, but cannot type commands, submit prompts, or send control/input sequences through the interactive shell. This makes E2B sandbox debugging effectively read-only and breaks any interactive workflow that depends on stdin.
