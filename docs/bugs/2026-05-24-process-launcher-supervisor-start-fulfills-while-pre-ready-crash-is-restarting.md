# Process launcher supervisor start fulfills while a pre-ready crash is restarting

## Summary

With readiness checks and automatic restart enabled, `createSupervisor().start()` fulfills when the initial process crashes before it becomes ready. The supervisor asynchronously begins replacement recovery, but the original startup caller has already been told startup succeeded while state remains `restarting` and no replacement has passed readiness.

## Reproduction

From the repository root, launch a mock service requiring a readiness log pattern, make its first process fail before emitting that pattern, and leave the replacement process waiting for readiness:

```sh
cat > /tmp/process-launcher-supervisor-pre-ready-crash-start-fulfills-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const firstStdout = new PassThrough();
let firstResolve;
const handles = [
  { pid: 101, stdout: firstStdout, stderr: null, stdin: null, result: new Promise((resolve) => { firstResolve = resolve; }), kill() {} },
  { pid: 202, stdout: new PassThrough(), stderr: null, stdin: null, result: new Promise(() => {}), kill() {} }
];
let execCount = 0;
const states = [];
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
  spec: { id: "job", command: "server", restart: "on-failure", backoffMs: 0, readyCheck: { kind: "log-pattern", pattern: "READY" } },
  runner: { name: "host", exec() { return handles[execCount++]; } }
});

const started = supervisor.start().then(() => "fulfilled", (error) => `rejected:${error.message}`);
await new Promise((resolve) => setTimeout(resolve, 5));
firstStdout.end();
firstResolve({ exitCode: 1 });
console.log("startResult=" + await started);
console.log("stateAtFulfillment=" + JSON.stringify(supervisor.getState()));
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("stateAfterRecoveryLaunch=" + JSON.stringify(supervisor.getState()));
console.log("execCount=" + execCount);
console.log("writes=" + JSON.stringify(states.map(({ pid, status, restartCount }) => ({ pid, status, restartCount }))));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-pre-ready-crash-start-fulfills-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '51,69p;109,157p;159,218p'
```

## Observed Behavior

The initial `start()` fulfills immediately after the pre-ready process fails, while the supervisor has not produced any ready service. Recovery begins only afterward, and the replacement process is still waiting for readiness:

```text
startResult=fulfilled
stateAtFulfillment={"id":"job","pid":null,"status":"restarting","runtime":"host","restartCount":1,"lastExitCode":1,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
stateAfterRecoveryLaunch={"id":"job","pid":202,"status":"restarting","runtime":"host","restartCount":1,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
execCount=2
writes=[{"pid":101,"status":"restarting","restartCount":0}]
```

`packages/process-launcher/src/supervisor/supervisor.ts:109` through `packages/process-launcher/src/supervisor/supervisor.ts:157` await readiness in the first launch. When the initial handle exits, `packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:218` abort that readiness wait, alter `runId` during recovery, and start a replacement asynchronously. The first `launch()` then returns through its stale-run guard, allowing `packages/process-launcher/src/supervisor/supervisor.ts:51` through `packages/process-launcher/src/supervisor/supervisor.ts:69` to fulfill `start()` although no process ever reached running readiness.

## Expected Behavior

If the initial launch fails before readiness and the supervisor enters automatic recovery, the original `start()` should either remain pending until a replacement passes readiness or reject the failed startup attempt. It should not fulfill while state says `restarting`.

## Impact

Consumers awaiting startup can begin dependent work during a recovery loop with no ready service. This masks startup crashes and makes retry-enabled supervision report success before it has delivered its readiness contract.
