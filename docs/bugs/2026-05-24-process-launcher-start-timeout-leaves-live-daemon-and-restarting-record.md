# Process launcher start timeout leaves a live daemon and restarting record

## Summary

The exported `startManagedProcess()` API rejects when its startup polling timeout expires, but it does not stop the spawned daemon or convert the bootstrap `restarting` record into a failed terminal state. If the daemon remains alive without publishing a ready/crashed state, the caller receives an error while the managed process remains active and persistently stuck in startup.

## Reproduction

From the repository root, start a managed process whose daemon PID remains alive but never updates the bootstrap state produced by `startManagedProcess()`:

```sh
cat > /tmp/process-launcher-start-timeout-leaves-live-daemon-probe.mjs <<'EOF'
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startManagedProcess } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const baseDir = await mkdtemp(path.join(os.tmpdir(), "launch-start-timeout-"));
let error;
try {
  await startManagedProcess({
    baseDir,
    spec: { id: "job", command: "server", restart: "never" },
    spawnDaemon: async () => 777,
    isPidRunning: (pid) => pid === 777,
    pollIntervalMs: 1,
    startupTimeoutMs: 5
  });
} catch (caught) {
  error = caught.message;
}
console.log("error=" + error);
console.log("state=" + await readFile(path.join(baseDir, "job", "state.json"), "utf8"));
console.log("meta=" + await readFile(path.join(baseDir, "job", "meta.json"), "utf8"));
EOF

node /tmp/process-launcher-start-timeout-leaves-live-daemon-probe.mjs

nl -ba packages/process-launcher/src/launcher.ts | sed -n '84,117p;353,393p;411,476p'
```

## Observed Behavior

The start operation rejects after its timeout, but durable state still identifies an active daemon and retains the non-terminal startup state:

```text
error=Timed out waiting for managed process "job".
state={
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
  "daemonPid": 777
}
```

`packages/process-launcher/src/launcher.ts:84` through `packages/process-launcher/src/launcher.ts:117` persist the bootstrap state and live daemon PID before waiting for a non-`restarting` state. `packages/process-launcher/src/launcher.ts:353` through `packages/process-launcher/src/launcher.ts:393` throw once the timeout elapses, without terminating the daemon or rewriting the process record. `packages/process-launcher/src/launcher.ts:411` through `packages/process-launcher/src/launcher.ts:476` continue treating a live daemon with `restarting` state as active.

## Expected Behavior

When startup times out, the API should either cancel and clean up the spawned daemon before rejecting, or return an explicit still-starting/live-daemon result that permits the caller to manage it. It should not reject while silently retaining an active daemon in an indefinite startup state.

## Impact

Automation that retries after a timeout can immediately fail because the first daemon is still considered active, while operators see a managed process stuck in `restarting` despite the original start request having failed. Hung daemons accumulate unless callers implement undocumented post-timeout cleanup.
