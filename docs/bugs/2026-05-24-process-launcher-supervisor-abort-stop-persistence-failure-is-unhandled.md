# Process launcher supervisor abort stop persistence failure is unhandled

## Summary

When a supervisor's cancellation signal aborts, `createSupervisor()` invokes `stop()` with `void` from its abort listener. If stopping reaches a failed state persistence write, the promise rejects without an observer and becomes an unhandled rejection even though the supervisor has already mutated its in-memory state to stopped.

## Reproduction

From the repository root, run a supervisor whose first state write succeeds and whose abort-triggered stopped-state write rejects:

```sh
cat > /tmp/process-launcher-supervisor-abort-stop-rejection-unhandled-probe.mjs <<'EOF'
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const controller = new AbortController();
const unhandled = [];
process.on("unhandledRejection", (error) => unhandled.push(error instanceof Error ? error.message : String(error)));
let resolveResult;
let stateWrites = 0;
const fs = {
  async mkdir() {},
  async readFile() { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
  async writeFile() { stateWrites += 1; if (stateWrites === 2) throw new Error("stop state offline"); },
  async rm() {},
  async stat() { return { isFile: () => false, mtimeMs: 0 }; },
  async readdir() { return []; },
  async appendFile() {}
};
const supervisor = createSupervisor({
  stateDir: "/virtual",
  fs,
  signal: controller.signal,
  spec: { id: "job", command: "server", restart: "never" },
  runner: { name: "host", exec() { return {
    pid: 123,
    stdout: null,
    stderr: null,
    stdin: null,
    result: new Promise((resolve) => { resolveResult = resolve; }),
    kill() { resolveResult({ exitCode: 0 }); }
  }; } }
});

await supervisor.start();
controller.abort();
await new Promise((resolve) => setTimeout(resolve, 15));
console.log("state=" + JSON.stringify(supervisor.getState()));
console.log("unhandled=" + JSON.stringify(unhandled));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-abort-stop-rejection-unhandled-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '45,49p;71,95p;221,233p'
```

## Observed Behavior

The abort path changes the public state to stopped but emits an unhandled rejection when it cannot persist that state:

```text
state={"id":"job","pid":null,"status":"stopped","runtime":"host","restartCount":0,"lastExitCode":0,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
unhandled=["stop state offline"]
```

`packages/process-launcher/src/supervisor/supervisor.ts:45` through `packages/process-launcher/src/supervisor/supervisor.ts:49` discard the promise returned by abort-triggered `stop()`. The stop flow mutates state and awaits the stopped transition in `packages/process-launcher/src/supervisor/supervisor.ts:71` through `packages/process-launcher/src/supervisor/supervisor.ts:95`, while `packages/process-launcher/src/supervisor/supervisor.ts:221` through `packages/process-launcher/src/supervisor/supervisor.ts:233` reject when persistence fails. No callback or returned promise exposes that cancellation failure.

## Expected Behavior

Failures while handling signal-driven shutdown should be contained or surfaced through an explicit supervisor error mechanism rather than becoming unhandled promise rejections. Persisted and in-memory state should remain consistent or failure should be reported deterministically.

## Impact

A disk or permission failure during cancellation can crash embedding applications configured to fail on unhandled rejections, precisely during shutdown handling. Callers cannot await or recover from the error because cancellation initiates stopping outside any public promise.
