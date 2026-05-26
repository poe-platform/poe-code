# E2B exec ignores inherited stdin input

## Summary

Regular commands executed through the E2B runtime default to inherited stdin at the shared command layer, but the E2B adapter only enables and forwards remote stdin when `stdin` is explicitly set to `"pipe"`. Commands requesting `stdin: "inherit"` receive no host input and the remote E2B command is launched without stdin enabled.

## Reproduction

1. From the repository root, run this disposable probe with a mocked E2B command service that records stdin options and delivery calls:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-exec-inherit-stdin-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";

   void (async () => {
     let runOptions: any;
     const sendStdinCalls: unknown[] = [];
     const commandHandle = { pid: 19, wait: async () => ({ exitCode: 0 }), kill: async () => true };
     const sandbox = {
       sandboxId: "sb",
       commands: {
         list: async () => [],
         run: async (_command: string, opts: unknown) => { runOptions = opts; return commandHandle; },
         connect: async () => commandHandle,
         sendStdin: async (...args: unknown[]) => { sendStdinCalls.push(args); },
         closeStdin: async () => {}, kill: async () => true
       },
       files: { read: async () => new Uint8Array(), write: async () => {}, watchDir: async () => ({ stop: async () => {} }) },
       pty: { create: async () => commandHandle, sendInput: async () => {}, kill: async () => true },
       setTimeout: async () => {}, kill: async () => {}
     } as any;
     const env = createOpenedE2bEnv({
       sandbox,
       runtime: { type: "e2b", build_args: {}, mounts: [] } as any,
       spec: { cwd: "/repo", runtime: {}, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "cat", argv: ["cat"] } } as any
     });
     const listenersBefore = process.stdin.listenerCount("data");
     const run = env.exec({ command: "cat", stdin: "inherit", stdout: "pipe", stderr: "pipe" });
     await Promise.resolve();
     process.stdin.emit("data", Buffer.from("hello\\n"));
     await Promise.resolve();
     console.log(JSON.stringify({ remoteStdinEnabled: runOptions.stdin, returnedStdin: run.stdin === process.stdin, listenersBefore, listenersAfter: process.stdin.listenerCount("data"), sendStdinCalls }));
     await run.result;
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The E2B command is launched without remote stdin and no local stdin data is forwarded:

```text
{"remoteStdinEnabled":false,"returnedStdin":false,"listenersBefore":0,"listenersAfter":0,"sendStdinCalls":[]}
```

The shared command runner uses inherited stdin by default in `packages/agent-harness-tools/src/run-poe-command.ts:59` through `packages/agent-harness-tools/src/run-poe-command.ts:68`. However, `runE2bCommand()` enables E2B stdin only for `spec.stdin === "pipe"` in `packages/runner-e2b/src/opened-env.ts:202` through `packages/runner-e2b/src/opened-env.ts:219`, and creates a stdin-forwarding writable only for that same mode in `packages/runner-e2b/src/opened-env.ts:220` through `packages/runner-e2b/src/opened-env.ts:243`. An inherited stdin request therefore becomes neither a returned inherited stream nor a forwarded remote stream.

## Expected Behavior

Commands launched on E2B with `stdin: "inherit"` should accept host stdin and forward it to the remote process, matching the `RunSpec` contract and the host/Docker runner behavior.

## Impact

Ordinary E2B command runs that expect terminal or piped input can start successfully but silently receive EOF or no input, causing interactive prompts and stdin-driven tools to hang, fail, or operate incorrectly unless callers know to opt into a backend-specific `"pipe"` workaround.
