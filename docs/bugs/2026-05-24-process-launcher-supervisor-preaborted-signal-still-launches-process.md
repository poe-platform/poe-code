# Process launcher supervisor with a pre-aborted signal still launches a process

## Summary

The exported `createSupervisor()` API accepts an `AbortSignal` for cancellation, but it only registers a future abort listener. If the signal is already aborted when the supervisor is created, calling `start()` still invokes the runner and transitions the new process to running instead of treating the requested supervision as already cancelled.

## Reproduction

From the repository root, construct a supervisor with an already-aborted signal and a recording runner:

```sh
cat > /tmp/process-launcher-supervisor-preaborted-signal-starts-process-probe.mjs <<'EOF'
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const controller = new AbortController();
controller.abort();
let launches = 0;
let resolveResult;
const supervisor = createSupervisor({
  stateDir: "/tmp/supervisor-preaborted-signal-state",
  signal: controller.signal,
  spec: { id: "job", command: "server", restart: "never" },
  runner: { name: "host", exec() {
    launches += 1;
    return {
      pid: 123,
      stdout: null,
      stderr: null,
      stdin: null,
      result: new Promise((resolve) => { resolveResult = resolve; }),
      kill() { resolveResult({ exitCode: 0 }); }
    };
  } }
});

const result = await Promise.race([
  supervisor.start().then(() => "fulfilled"),
  new Promise((resolve) => setTimeout(() => resolve("pending"), 10))
]);
console.log("result=" + result);
console.log("launches=" + launches);
console.log("state=" + JSON.stringify(supervisor.getState()));
await supervisor.stop();
EOF

node /tmp/process-launcher-supervisor-preaborted-signal-starts-process-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '34,69p;109,157p'
```

## Observed Behavior

Despite the signal already being aborted, startup fulfills, the runner is invoked once, and the process is reported running:

```text
result=fulfilled
launches=1
state={"id":"job","pid":123,"status":"running","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]}
```

`packages/process-launcher/src/supervisor/supervisor.ts:45` through `packages/process-launcher/src/supervisor/supervisor.ts:49` attach an event listener but never inspect `options.signal.aborted` at construction or startup. `packages/process-launcher/src/supervisor/supervisor.ts:51` through `packages/process-launcher/src/supervisor/supervisor.ts:69` proceed normally, and `packages/process-launcher/src/supervisor/supervisor.ts:109` through `packages/process-launcher/src/supervisor/supervisor.ts:157` invoke the runner and persist running state.

## Expected Behavior

A supervisor created with an already-aborted cancellation signal should not launch a child process. `start()` should resolve as cancelled or reject without executing the configured command.

## Impact

Callers that cancel work before construction can still start background processes and incur external side effects during shutdown or abandoned startup flows. This violates the advertised cancellation channel at the direct supervisor API level.
