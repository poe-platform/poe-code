# Process launcher supervisor start resolves after readiness failure kills the process

## Summary

The exported `createSupervisor()` API treats a failed startup readiness check as a normal completion of `start()`. When a configured readiness check times out, the supervisor sends `SIGTERM` to the just-launched process and eventually records it as stopped, but the original `await supervisor.start()` still resolves successfully instead of reporting that startup failed.

## Reproduction

From the repository root, create a supervisor whose mock process never opens the configured TCP readiness port and resolves with a failure exit after receiving the supervisor's kill signal:

```sh
cat > /tmp/process-launcher-supervisor-readiness-failure-resolves-probe.mjs <<'EOF'
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

let resolveResult;
const kills = [];
const handle = {
  pid: 123,
  stdout: null,
  stderr: null,
  stdin: null,
  result: new Promise((resolve) => { resolveResult = resolve; }),
  kill(signal) {
    kills.push(signal);
    resolveResult({ exitCode: 1 });
  }
};
const stateDir = await mkdtemp(path.join(os.tmpdir(), "supervisor-ready-fail-"));
const supervisor = createSupervisor({
  stateDir,
  spec: {
    id: "job",
    command: "server",
    restart: "never",
    readyCheck: { kind: "tcp", host: "127.0.0.1", port: 1, timeoutMs: 5 }
  },
  runner: { name: "host", exec() { return handle; } }
});

await supervisor.start();
await new Promise((resolve) => setTimeout(resolve, 15));
console.log(`stateAfterStart=${JSON.stringify(supervisor.getState())}`);
console.log(`kills=${kills.join(",")}`);
console.log(`persisted=${await readFile(path.join(stateDir, "job", "state.json"), "utf8")}`);
EOF

node /tmp/process-launcher-supervisor-readiness-failure-resolves-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '51,68p;109,157p;159,219p'
```

## Observed Behavior

`supervisor.start()` returns without an error even though readiness failed, the supervisor terminated the new process, and persisted state says the process is stopped with a non-zero exit code:

```text
stateAfterStart={"id":"job","pid":null,"status":"stopped","runtime":"host","restartCount":0,"lastExitCode":1,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
kills=SIGTERM
persisted={
  "id": "job",
  "pid": null,
  "status": "stopped",
  "runtime": "host",
  "restartCount": 0,
  "lastExitCode": 1,
  "lastStartedAt": "...",
  "lastStoppedAt": "...",
  "command": "server",
  "args": []
}
```

`packages/process-launcher/src/supervisor/supervisor.ts:51` through `packages/process-launcher/src/supervisor/supervisor.ts:68` resolve `start()` whenever `launch()` returns. In `packages/process-launcher/src/supervisor/supervisor.ts:132` through `packages/process-launcher/src/supervisor/supervisor.ts:148`, failed readiness kills the process and simply returns from `launch()` rather than rejecting. The asynchronous monitor then persists the failed exit as stopped at `packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:188`.

## Expected Behavior

When a configured startup readiness check fails and the supervisor terminates the attempted process, `start()` should reject with a readiness/startup failure. Successful fulfillment should mean that the supervised process became ready and is running.

## Impact

Consumers awaiting supervisor startup can continue as though a service is available after the library has already killed it for failing readiness. This masks health failures, breaks startup orchestration, and forces every caller to poll supervisor state after an ostensibly successful `start()` to determine whether launch actually worked.
