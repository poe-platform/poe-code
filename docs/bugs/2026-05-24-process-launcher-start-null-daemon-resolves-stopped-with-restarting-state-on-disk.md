# Process launcher start with a null daemon resolves stopped while state remains restarting on disk

## Summary

The `startManagedProcess()` contract allows `spawnDaemon()` to return `null`. When it does, record normalization synthesizes a stopped result in memory because there is no running daemon, so the start call resolves successfully. However, that synthesized stopped result is never written back, leaving the persisted `state.json` in its original `restarting` bootstrap state.

## Reproduction

From the repository root, invoke `startManagedProcess()` using a daemon launcher that reports no process PID:

```sh
cat > /tmp/process-launcher-start-null-daemon-resolves-stopped-probe.mjs <<'EOF'
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startManagedProcess } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const baseDir = await mkdtemp(path.join(os.tmpdir(), "launch-null-daemon-"));
const result = await startManagedProcess({
  baseDir,
  spec: { id: "job", command: "server", restart: "never" },
  spawnDaemon: async () => null,
  pollIntervalMs: 1,
  startupTimeoutMs: 5
});
console.log("returned=" + JSON.stringify(result));
console.log("persistedState=" + await readFile(path.join(baseDir, "job", "state.json"), "utf8"));
console.log("meta=" + await readFile(path.join(baseDir, "job", "meta.json"), "utf8"));
EOF

node /tmp/process-launcher-start-null-daemon-resolves-stopped-probe.mjs

nl -ba packages/process-launcher/src/launcher.ts | sed -n '84,117p;353,373p;396,476p'
```

## Observed Behavior

The returned record says the process is stopped and the start operation fulfills, but the only state persisted on disk still says the process is restarting:

```text
returned={"daemonPid":null,"spec":{"id":"job","command":"server","restart":"never","args":[]},"state":{"args":[],"command":"server","id":"job","lastExitCode":null,"lastStartedAt":null,"lastStoppedAt":"...","pid":null,"restartCount":0,"runtime":"host","status":"stopped"}}
persistedState={
  "args": [],
  "command": "server",
  "id": "job",
  "lastExitCode": null,
  "lastStartedAt": null,
  "lastStoppedAt": null,
  "pid": null,
  "restartCount": 0,
  "runtime": "host",
  "status": "restarting"
}
meta={
  "daemonPid": null
}
```

`packages/process-launcher/src/launcher.ts:84` through `packages/process-launcher/src/launcher.ts:117` persist the bootstrap record, then accept the first normalized state not marked `restarting`. With a null daemon PID, `packages/process-launcher/src/launcher.ts:396` through `packages/process-launcher/src/launcher.ts:476` synthesize a stopped record because the active bootstrap state has no running daemon, but `startManagedProcess()` returns it without persisting that transition.

## Expected Behavior

Returning `null` from daemon spawning should be treated as startup failure, or any synthesized terminal state should be persisted before fulfillment. The public return value and durable launch state must agree.

## Impact

Callers can receive a successful stopped result while later CLI and SDK operations read stale `restarting` state from disk. This creates contradictory launch status across processes and can obscure daemon-launch failures or cleanup decisions.
