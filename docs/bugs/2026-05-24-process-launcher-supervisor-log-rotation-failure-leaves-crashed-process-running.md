# Process launcher supervisor log rotation failure leaves a crashed process running

## Summary

When a supervised process exits with a restart-eligible failure, `createSupervisor()` mutates its in-memory terminal fields and increments `restartCount` before attempting log rotation. If rotation rejects, the detached exit monitor rejects without persisting a `restarting` or `crashed` transition and without launching a replacement, leaving state with `status: "running"` even though `pid` is null and the process has already failed.

## Reproduction

From the repository root, run a restart-on-failure supervisor whose child exits non-zero and whose filesystem adapter fails when log rotation probes existing rotated files:

```sh
cat > /tmp/process-launcher-supervisor-log-rotation-rejection-probe.mjs <<'EOF'
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

let resolveResult;
const unhandled = [];
process.on("unhandledRejection", (error) => {
  unhandled.push(error instanceof Error ? error.message : String(error));
});
const writes = [];
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile(_path, content) {
    const state = JSON.parse(content);
    writes.push({ pid: state.pid, status: state.status, restartCount: state.restartCount, lastExitCode: state.lastExitCode });
  },
  async rm() {},
  async stat() { throw new Error("rotation storage offline"); },
  async readdir() { return []; },
  async appendFile() {}
};
const supervisor = createSupervisor({
  stateDir: "/virtual/state",
  fs,
  spec: { id: "job", command: "server", restart: "on-failure", backoffMs: 0 },
  runner: {
    name: "host",
    exec() {
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin: null,
        result: new Promise((resolve) => { resolveResult = resolve; }),
        kill() {}
      };
    }
  }
});

await supervisor.start();
resolveResult({ exitCode: 1 });
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("state=" + JSON.stringify(supervisor.getState()));
console.log("writes=" + JSON.stringify(writes));
console.log("unhandled=" + JSON.stringify(unhandled));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-log-rotation-rejection-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '159,218p'
nl -ba packages/process-launcher/src/logs/log-writer.ts | sed -n '17,49p;121,145p'
```

## Observed Behavior

After the child fails, no replacement is started and no terminal/restarting state is persisted. The supervisor exposes a contradictory state showing a running service with no PID and a recorded failure exit, while the detached monitor emits an unhandled rejection:

```text
state={"id":"job","pid":null,"status":"running","runtime":"host","restartCount":1,"lastExitCode":1,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
writes=[{"pid":123,"status":"running","restartCount":0,"lastExitCode":null}]
unhandled=["rotation storage offline"]
```

`packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:218` clear the active handle, record failure fields, increment `restartCount`, then await `logWriter.rotate()` before `transitionTo("restarting")`. `packages/process-launcher/src/logs/log-writer.ts:17` through `packages/process-launcher/src/logs/log-writer.ts:49` and `packages/process-launcher/src/logs/log-writer.ts:121` through `packages/process-launcher/src/logs/log-writer.ts:145` can reject during that rotation. Because the monitor was started without an observer, that rejection is unhandled and the lifecycle transition never occurs.

## Expected Behavior

Log rotation failure during a required restart should not leave a failed process recorded as running. The supervisor should surface or contain the rotation error while persisting a truthful terminal/recovery state and making restart policy outcome deterministic.

## Impact

An inaccessible log filesystem during crash recovery can halt automatic restart, emit an unhandled rejection that may terminate the embedding application, and expose a state record that falsely claims the dead service is running. Health orchestration and operator commands can act on a non-existent process while durable state remains stale.
