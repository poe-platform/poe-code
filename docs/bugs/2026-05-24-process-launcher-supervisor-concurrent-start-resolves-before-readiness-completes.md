# Process launcher supervisor concurrent start resolves before readiness completes

## Summary

The exported `createSupervisor()` API returns immediately from `start()` whenever a process handle already exists, even if the first `start()` call is still waiting for that process to satisfy its configured readiness check. A concurrent caller can therefore observe successful startup while the same service is still marked `restarting` and has not become ready.

## Reproduction

From the repository root, start a mock service that does not emit its readiness line until after a second caller invokes `start()`:

```sh
cat > /tmp/process-launcher-supervisor-concurrent-start-ready-pending-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const stdout = new PassThrough();
const handle = {
  pid: 123,
  stdout,
  stderr: null,
  stdin: null,
  result: new Promise(() => {}),
  kill() {}
};
const supervisor = createSupervisor({
  stateDir: "/tmp/supervisor-concurrent-start-state",
  spec: { id: "job", command: "server", restart: "never", readyCheck: { kind: "log-pattern", pattern: "READY" } },
  runner: { name: "host", exec() { return handle; } }
});

let firstSettled = false;
const first = supervisor.start().then(() => { firstSettled = true; return "fulfilled"; });
await new Promise((resolve) => setTimeout(resolve, 5));
const second = await Promise.race([
  supervisor.start().then(() => "fulfilled"),
  new Promise((resolve) => setTimeout(() => resolve("pending"), 10))
]);
console.log("beforeReady=" + JSON.stringify({ firstSettled, second, state: supervisor.getState() }));
stdout.write("READY\n");
console.log("afterReady=" + JSON.stringify({ first: await first, state: supervisor.getState() }));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-concurrent-start-ready-pending-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '51,69p;109,157p'
```

## Observed Behavior

The second `start()` fulfills before the mock process emits `READY`, while the original startup promise remains unsettled and supervisor state still says startup is in progress:

```text
beforeReady={"firstSettled":false,"second":"fulfilled","state":{"id":"job","pid":123,"status":"restarting","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]}}
afterReady={"first":"fulfilled","state":{"id":"job","pid":123,"status":"running","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]}}
```

`packages/process-launcher/src/supervisor/supervisor.ts:51` through `packages/process-launcher/src/supervisor/supervisor.ts:69` check `handle !== null` before checking `startPromise !== null`, so a concurrent caller returns as soon as launch creates the handle. Meanwhile, `packages/process-launcher/src/supervisor/supervisor.ts:109` through `packages/process-launcher/src/supervisor/supervisor.ts:157` intentionally keep the initial `start()` pending until the readiness check completes.

## Expected Behavior

Every `start()` call issued while the same startup attempt is in progress should await the in-flight startup/readiness promise and resolve only once the process is actually ready, or reject if that startup fails.

## Impact

Concurrent consumers can treat a not-yet-ready service as successfully started and begin sending work before it is available. This creates nondeterministic orchestration failures whenever multiple components call `start()` on the same supervisor during startup.
