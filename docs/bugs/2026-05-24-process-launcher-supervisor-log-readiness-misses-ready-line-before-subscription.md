# Process launcher supervisor log readiness misses a ready line emitted before subscription

## Summary

For a `log-pattern` readiness check, `createSupervisor()` begins pumping process output before it subscribes the readiness listener. Because it awaits persistence of the initial `restarting` transition before calling `waitForReady()`, a process can emit its only readiness line during that gap. The line is delivered to the public log callback but is not remembered for readiness, so the supervisor later times out and kills a process that already announced it was ready.

## Reproduction

From the repository root, delay only the supervisor's first state write, emit `READY` while that write is pending, and shorten the default log-readiness timeout for a quick probe:

```sh
cat > /tmp/process-launcher-supervisor-early-readiness-log-missed-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((callback, delay, ...args) => originalSetTimeout(callback, delay === 30_000 ? 5 : delay, ...args));
const stdout = new PassThrough();
let releaseFirstStateWrite;
let firstWrite = true;
let resolveResult;
const logs = [];
const kills = [];
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile() {
    if (firstWrite) {
      firstWrite = false;
      await new Promise((resolve) => { releaseFirstStateWrite = resolve; });
    }
  },
  async rm() {},
  async stat() { return { isFile: () => false, mtimeMs: 0 }; },
  async readdir() { return []; },
  async appendFile() {}
};
const supervisor = createSupervisor({
  stateDir: "/virtual/state",
  fs,
  onLog(line) { logs.push(line); },
  spec: { id: "job", command: "server", restart: "never", readyCheck: { kind: "log-pattern", pattern: "READY" } },
  runner: { name: "host", exec() { return {
    pid: 123,
    stdout,
    stderr: null,
    stdin: null,
    result: new Promise((resolve) => { resolveResult = resolve; }),
    kill(signal) { kills.push(signal); resolveResult({ exitCode: 1 }); }
  }; } }
});

const startResult = supervisor.start().then(() => "fulfilled", (error) => `rejected:${error.message}`);
await new Promise((resolve) => setTimeout(resolve, 1));
stdout.write("READY\n");
releaseFirstStateWrite();
await new Promise((resolve) => setTimeout(resolve, 15));
console.log("logs=" + JSON.stringify(logs));
console.log("startResult=" + await startResult);
console.log("kills=" + JSON.stringify(kills));
console.log("state=" + JSON.stringify(supervisor.getState()));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-early-readiness-log-missed-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '125,157p;384,454p'
nl -ba packages/process-launcher/src/health/health-check.ts | sed -n '24,67p'
```

## Observed Behavior

The readiness line is seen through `onLog`, but it is not counted as readiness. The check times out, sends `SIGTERM`, and `start()` still fulfills through the existing failed-readiness behavior:

```text
logs=["READY"]
startResult=fulfilled
kills=["SIGTERM"]
state={"id":"job","pid":123,"status":"restarting","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]}
```

`packages/process-launcher/src/supervisor/supervisor.ts:125` through `packages/process-launcher/src/supervisor/supervisor.ts:130` attach log pumping immediately after execution begins. It then awaits `transitionTo("restarting")` before setting up readiness at `packages/process-launcher/src/supervisor/supervisor.ts:132` through `packages/process-launcher/src/supervisor/supervisor.ts:148`. `packages/process-launcher/src/supervisor/supervisor.ts:384` through `packages/process-launcher/src/supervisor/supervisor.ts:454` forward emitted lines only to current listeners, and `packages/process-launcher/src/health/health-check.ts:24` through `packages/process-launcher/src/health/health-check.ts:67` subscribe without inspecting prior output.

## Expected Behavior

A readiness line emitted by the launched process at any point after output capture begins should satisfy the readiness check. The supervisor should subscribe before output can be delivered or buffer/replay startup lines needed by readiness detection.

## Impact

Fast-starting applications can be terminated as unhealthy merely because persistence or scheduling delayed readiness subscription. Startup becomes timing-dependent, and services that print a single ready message early may fail nondeterministically despite successfully initializing.
