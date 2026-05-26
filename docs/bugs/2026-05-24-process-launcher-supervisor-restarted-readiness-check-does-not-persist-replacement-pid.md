# Process launcher supervisor restarted readiness check does not persist replacement PID

## Summary

When `createSupervisor()` automatically launches a replacement process after a failure and that process has a configured readiness check, the replacement PID is stored only in memory while readiness is pending. The previously persisted restart transition already has status `restarting`, so the replacement launch's `transitionTo("restarting")` returns without writing its new PID or start timestamp to durable state.

## Reproduction

From the repository root, run a supervisor whose first process becomes ready and then fails. Its automatic replacement starts but deliberately never emits the required readiness log line:

```sh
cat > /tmp/process-launcher-supervisor-restart-readiness-pid-not-persisted-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const firstStdout = new PassThrough();
let firstResolve;
const states = [];
const handles = [
  { pid: 101, stdout: firstStdout, stderr: null, stdin: null, result: new Promise((resolve) => { firstResolve = resolve; }), kill() {} },
  { pid: 202, stdout: null, stderr: null, stdin: null, result: new Promise(() => {}), kill() {} }
];
let count = 0;
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile(_file, content) { states.push(JSON.parse(content)); },
  async rm() {},
  async stat() { return { isFile: () => false, mtimeMs: 0 }; },
  async readdir() { return []; },
  async appendFile() {}
};
const supervisor = createSupervisor({
  stateDir: "/virtual/state",
  fs,
  spec: {
    id: "job", command: "server", restart: "on-failure", backoffMs: 0,
    readyCheck: { kind: "log-pattern", pattern: "READY" }
  },
  runner: { name: "host", exec() { return handles[count++]; } }
});
const initialStart = supervisor.start();
await new Promise((resolve) => setTimeout(resolve, 5));
firstStdout.write("READY\n");
await initialStart;
firstStdout.end();
firstResolve({ exitCode: 1 });
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("replacementInMemory=" + JSON.stringify(supervisor.getState()));
console.log("lastPersisted=" + JSON.stringify(states.at(-1)));
console.log("allWrites=" + JSON.stringify(states.map(({ pid, status, restartCount }) => ({ pid, status, restartCount }))));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-restart-readiness-pid-not-persisted-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '109,157p;159,218p;221,233p'
```

## Observed Behavior

The supervisor has launched replacement PID `202` and is actively waiting for that process to become ready, but the last persisted state still says no process is present and retains metadata from the failed PID `101`:

```text
replacementInMemory={"id":"job","pid":202,"status":"restarting","runtime":"host","restartCount":1,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
lastPersisted={"id":"job","pid":null,"status":"restarting","runtime":"host","restartCount":1,"lastExitCode":1,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
allWrites=[{"pid":101,"status":"restarting","restartCount":0},{"pid":101,"status":"running","restartCount":0},{"pid":null,"status":"restarting","restartCount":1}]
```

`packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:218` persist the failed process as `restarting` before invoking replacement launch. The replacement updates `state.pid`, clears `lastExitCode`, and updates `lastStartedAt` at `packages/process-launcher/src/supervisor/supervisor.ts:109` through `packages/process-launcher/src/supervisor/supervisor.ts:123`, then calls `transitionTo("restarting")` while awaiting readiness at `packages/process-launcher/src/supervisor/supervisor.ts:132` through `packages/process-launcher/src/supervisor/supervisor.ts:149`. Since the persisted state already has the same status, `packages/process-launcher/src/supervisor/supervisor.ts:221` through `packages/process-launcher/src/supervisor/supervisor.ts:233` skip the write entirely.

## Expected Behavior

When a replacement process has started but is still undergoing readiness checks, durable state should record its actual PID and current startup metadata while keeping status `restarting` until readiness succeeds or fails.

## Impact

Long readiness checks create a window where the supervisor is managing a live replacement process that persistent state cannot identify. External inspection, cleanup, or recovery after a supervisor crash can miss the live process, report stale failure metadata, or leave an orphaned replacement process running outside recorded lifecycle state.
