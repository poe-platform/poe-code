# Process launcher stop timeout marks a still-running daemon as stopped

## Summary

The exported `stopManagedProcess()` waits for a managed process to stop only until its timeout expires. If the daemon is still running at that point, the function does not reject or retain the active state; instead it overwrites persisted state as `stopped`, clears `daemonPid`, and returns success while the process remains alive according to its own process-status dependency.

## Reproduction

From the repository root, seed a running managed-process record and supply an `isPidRunning()` implementation that continues to report the daemon and child as alive after the termination signal:

```sh
cat > /tmp/process-launcher-stop-timeout-marks-running-stopped-probe.mjs <<'EOF'
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stopManagedProcess } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const baseDir = await mkdtemp(path.join(os.tmpdir(), "launch-stop-timeout-"));
const id = "job";
const dir = path.join(baseDir, id);
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "spec.json"), JSON.stringify({
  id, command: "/bin/sleep", args: ["100"], restart: "never"
}));
await writeFile(path.join(dir, "state.json"), JSON.stringify({
  id, command: "/bin/sleep", args: ["100"], status: "running", runtime: "host",
  pid: 222, restartCount: 0, lastExitCode: null, lastStartedAt: "start", lastStoppedAt: null
}));
await writeFile(path.join(dir, "meta.json"), JSON.stringify({ daemonPid: 111 }));

const signals = [];
const result = await stopManagedProcess({
  baseDir,
  id,
  pollIntervalMs: 1,
  stopTimeoutMs: 2,
  isPidRunning: (pid) => pid === 111 || pid === 222,
  signalProcess: (pid, signal) => signals.push(`${pid}:${signal}`)
});
console.log(`signals=${signals.join(",")}`);
console.log(`returnedStatus=${result?.state?.status}`);
console.log(`returnedPid=${result?.state?.pid}`);
console.log(`returnedDaemonPid=${result?.daemonPid}`);
console.log(`persisted=${await readFile(path.join(dir, "state.json"), "utf8")}`);
console.log(`meta=${await readFile(path.join(dir, "meta.json"), "utf8")}`);
EOF

node /tmp/process-launcher-stop-timeout-marks-running-stopped-probe.mjs

nl -ba packages/process-launcher/src/launcher.ts | sed -n '119,179p;375,393p;411,443p'
```

## Observed Behavior

Only `SIGTERM` is requested; despite `isPidRunning()` continuing to report the daemon as alive, the operation returns and persists a stopped state with the daemon PID erased:

```text
signals=111:SIGTERM
returnedStatus=stopped
returnedPid=null
returnedDaemonPid=null
persisted={
  "id": "job",
  "command": "/bin/sleep",
  "args": ["100"],
  "status": "stopped",
  "runtime": "host",
  "pid": null,
  "restartCount": 0,
  "lastExitCode": null,
  "lastStartedAt": "start",
  "lastStoppedAt": "..."
}
meta={
  "daemonPid": null
}
```

`packages/process-launcher/src/launcher.ts:148` through `packages/process-launcher/src/launcher.ts:165` interpret an active record returned after `waitForStop()` as a reason to synthesize and persist a stopped record, rather than as a timeout failure. `packages/process-launcher/src/launcher.ts:375` through `packages/process-launcher/src/launcher.ts:393` return the still-active record when the deadline elapses, and `packages/process-launcher/src/launcher.ts:411` through `packages/process-launcher/src/launcher.ts:443` otherwise recognize that the daemon is live.

## Expected Behavior

If a daemon remains active after the configured stop timeout, `stopManagedProcess()` should reject or return an explicitly still-running/timed-out result without clearing process identifiers or persisting `stopped`. State must continue to reflect a process that the launcher still observes as alive.

## Impact

Callers can believe a service has stopped and lose the tracked daemon PID while the unmanaged process continues running. Subsequent start or remove operations may conflict with the orphaned live service, leak resources, or make it difficult to terminate the actual process because launcher state falsely reports successful shutdown.
