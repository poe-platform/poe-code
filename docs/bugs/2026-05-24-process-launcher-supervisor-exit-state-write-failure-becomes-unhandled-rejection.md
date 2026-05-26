# Process launcher supervisor exit state write failure becomes an unhandled rejection

## Summary

The exported `createSupervisor()` API launches background exit monitoring with `void monitorExit(...)`. If persisting the terminal process state fails after a child exits, that rejected asynchronous monitor is never awaited or caught, producing an unhandled promise rejection while the in-memory state has already been changed to stopped.

## Reproduction

From the repository root, run a supervisor with an in-memory filesystem adapter that permits the initial running-state write and rejects the later stopped-state write after the process exits:

```sh
cat > /tmp/process-launcher-supervisor-exit-write-rejection-probe.mjs <<'EOF'
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

let resolveResult;
const unhandled = [];
process.once("unhandledRejection", (error) => {
  unhandled.push(error instanceof Error ? error.message : String(error));
});
let writes = 0;
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile() {
    writes += 1;
    if (writes === 2) throw new Error("disk offline");
  },
  async rm() {},
  async stat() { return { isFile: () => false, mtimeMs: 0 }; },
  async readdir() { return []; },
  async appendFile() {}
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
console.log("afterStart=" + JSON.stringify(supervisor.getState()));
resolveResult({ exitCode: 1 });
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("afterExit=" + JSON.stringify(supervisor.getState()));
console.log("unhandled=" + JSON.stringify(unhandled));
EOF

node /tmp/process-launcher-supervisor-exit-write-rejection-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '125,130p;159,188p;221,244p'
```

## Observed Behavior

The exited process is reflected as stopped in memory, but the failed state persistence escapes as a process-level unhandled rejection:

```text
afterStart={"id":"job","pid":123,"status":"running","runtime":"host","restartCount":0,"lastExitCode":null,"lastStartedAt":"...","lastStoppedAt":null,"command":"server","args":[]}
afterExit={"id":"job","pid":null,"status":"stopped","runtime":"host","restartCount":0,"lastExitCode":1,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
unhandled=["disk offline"]
```

`packages/process-launcher/src/supervisor/supervisor.ts:129` through `packages/process-launcher/src/supervisor/supervisor.ts:130` deliberately discard the promise returned by `monitorExit()`. When the child exits, `packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:188` mutate the process state and await `transitionTo("stopped")`, while `packages/process-launcher/src/supervisor/supervisor.ts:221` through `packages/process-launcher/src/supervisor/supervisor.ts:232` reject if `stateStore.write()` fails. No owner observes that rejected monitoring promise.

## Expected Behavior

State-persistence failure during asynchronous process exit handling should be surfaced through a controlled supervisor error/event channel or safely contained. It should not become an unhandled rejection from routine background monitoring.

## Impact

A transient storage failure during normal child termination can crash embedding applications configured to terminate on unhandled rejections, while leaving callers with in-memory state that no longer matches persisted state. This makes supervised process lifecycle failures both unsafe and difficult to recover from deterministically.
