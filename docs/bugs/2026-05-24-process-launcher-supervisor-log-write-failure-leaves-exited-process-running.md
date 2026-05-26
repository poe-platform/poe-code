# Process launcher supervisor log write failure leaves an exited process running

## Summary

The exported `createSupervisor()` API waits for all captured log writes before processing a child exit. If a log persistence write rejects, its output promise rejects before the child exits and becomes unhandled; once the child later exits, `monitorExit()` rejects on the same failed output promise before clearing the active handle or transitioning state, leaving a terminated process reported as running.

## Reproduction

From the repository root, run a supervisor whose mock child emits one line and then exits, while the supplied filesystem adapter rejects log appends but accepts state writes:

```sh
cat > /tmp/process-launcher-supervisor-log-write-rejection-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const stdout = new PassThrough();
let resolveResult;
const unhandled = [];
process.on("unhandledRejection", (error) => {
  unhandled.push(error instanceof Error ? error.message : String(error));
});
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile() {},
  async rm() {},
  async stat() { return { isFile: () => false, mtimeMs: 0 }; },
  async readdir() { return []; },
  async appendFile() { throw new Error("log disk offline"); }
};
const supervisor = createSupervisor({
  stateDir: "/virtual/state",
  fs,
  spec: { id: "job", command: "server", restart: "never" },
  runner: {
    name: "host",
    exec() {
      return {
        pid: 123,
        stdout,
        stderr: null,
        stdin: null,
        result: new Promise((resolve) => { resolveResult = resolve; }),
        kill() {}
      };
    }
  }
});

await supervisor.start();
stdout.end("hello\n");
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("whileRunning=" + JSON.stringify({ state: supervisor.getState(), unhandled }));
resolveResult({ exitCode: 0 });
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("afterExit=" + JSON.stringify({ state: supervisor.getState(), unhandled }));
process.exit(0);
EOF

node --no-warnings /tmp/process-launcher-supervisor-log-write-rejection-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '125,130p;159,188p;406,454p'
```

## Observed Behavior

The log write failure is already reported as an unhandled rejection while the child remains active. After resolving the child's successful exit, the supervisor still exposes the previous running PID and the failed output handling generates another unhandled rejection:

```text
whileRunning={"state":{"id":"job","pid":123,"status":"running","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]},"unhandled":["log disk offline"]}
afterExit={"state":{"id":"job","pid":123,"status":"running","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]},"unhandled":["log disk offline","log disk offline"]}
```

`packages/process-launcher/src/supervisor/supervisor.ts:125` through `packages/process-launcher/src/supervisor/supervisor.ts:130` pass the uncaught output-write promise into detached `monitorExit()`. `packages/process-launcher/src/supervisor/supervisor.ts:406` through `packages/process-launcher/src/supervisor/supervisor.ts:454` reject `pipeOutput()` when a log append fails. After the child result resolves, `packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:188` await that failed output promise before clearing `handle`, `pid`, or status, so terminal state processing never executes.

## Expected Behavior

A log persistence failure should be reported or contained without preventing an exited child from being recorded as stopped or crashed. Background output handling should not create unhandled rejections or retain a dead process as running.

## Impact

A full disk, permission change, or transient log-storage error can leave supervisor state permanently claiming that an exited process is live, prevent restart policy processing, and generate unhandled promise rejections that can crash the host application. Callers can no longer trust lifecycle state after an unrelated log persistence failure.
