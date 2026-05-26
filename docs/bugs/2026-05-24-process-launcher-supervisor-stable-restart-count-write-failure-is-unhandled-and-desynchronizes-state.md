# Process launcher supervisor stable restart-count write failure is unhandled and desynchronizes state

## Summary

After a restarted process remains alive for the supervisor's stable-uptime interval, `createSupervisor()` resets `restartCount` in memory and persists that reset from a timer using `void stateStore.write(...)`. If that persistence write fails, the rejection is unhandled and the supervisor continues reporting the reset in memory even though durable state still records the previous restart count.

## Reproduction

From the repository root, run a supervisor whose first process fails, whose replacement remains running, and whose filesystem adapter rejects only the stable restart-count reset write. The probe shortens the 60-second stable timer so the behavior can be reproduced immediately:

```sh
cat > /tmp/process-launcher-supervisor-stable-reset-write-rejection-probe.mjs <<'EOF'
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((callback, delay, ...args) => originalSetTimeout(callback, delay === 60_000 ? 0 : delay, ...args));
const unhandled = [];
process.once("unhandledRejection", (error) => {
  unhandled.push(error instanceof Error ? error.message : String(error));
});
const writes = [];
let firstResolve;
let secondResolve;
const handles = [
  {
    pid: 1,
    stdout: null,
    stderr: null,
    stdin: null,
    result: new Promise((resolve) => { firstResolve = resolve; }),
    kill() {}
  },
  {
    pid: 2,
    stdout: null,
    stderr: null,
    stdin: null,
    result: new Promise((resolve) => { secondResolve = resolve; }),
    kill() { secondResolve({ exitCode: 0 }); }
  }
];
let execCount = 0;
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile(_file, content) {
    const snapshot = JSON.parse(content);
    writes.push({ pid: snapshot.pid, status: snapshot.status, restartCount: snapshot.restartCount });
    if (snapshot.pid === 2 && snapshot.status === "running" && snapshot.restartCount === 0) {
      throw new Error("disk offline during stable reset");
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
  spec: { id: "job", command: "server", restart: "on-failure", backoffMs: 0 },
  runner: { name: "host", exec() { return handles[execCount++]; } }
});

await supervisor.start();
firstResolve({ exitCode: 1 });
await new Promise((resolve) => setTimeout(resolve, 15));
console.log("state=" + JSON.stringify(supervisor.getState()));
console.log("writes=" + JSON.stringify(writes));
console.log("unhandled=" + JSON.stringify(unhandled));
await supervisor.stop();
EOF

node /tmp/process-launcher-supervisor-stable-reset-write-rejection-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '159,218p;235,244p'
```

## Observed Behavior

The replacement process transitions through `restartCount: 1`, then the timer changes the public in-memory state to `restartCount: 0` even though its attempted persistence fails and escapes as an unhandled rejection:

```text
state={"id":"job","pid":2,"status":"running","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
writes=[{"pid":1,"status":"running","restartCount":0},{"pid":null,"status":"restarting","restartCount":1},{"pid":2,"status":"running","restartCount":1},{"pid":2,"status":"running","restartCount":0}]
unhandled=["disk offline during stable reset"]
```

`packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:218` increment and persist the restart counter during recovery. Later, `packages/process-launcher/src/supervisor/supervisor.ts:235` through `packages/process-launcher/src/supervisor/supervisor.ts:244` mutate `state.restartCount` first and discard the promise returned by the reset persistence write, so rejection neither rolls back the in-memory reset nor reaches a controlled supervisor API.

## Expected Behavior

The stable-uptime restart-counter reset should update durable and in-memory state consistently, and a failed persistence operation should be contained or reported through a controlled error mechanism rather than becoming an unhandled rejection.

## Impact

A state-store outage after a successful process recovery can crash embedding applications through an unhandled rejection and can cause runtime decisions based on `getState()` to disagree with persisted restart history. Subsequent supervision after reload may apply different restart limits or backoff accounting than the live supervisor advertised.
