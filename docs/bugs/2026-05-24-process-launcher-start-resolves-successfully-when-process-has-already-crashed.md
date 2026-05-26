# Process launcher start resolves successfully when the process has already crashed

## Summary

The exported `startManagedProcess()` function waits only until managed state is no longer `restarting`, then resolves with whatever record it observes. If the daemon reports that the process crashed during startup, `startManagedProcess()` resolves normally with `state.status: "crashed"` rather than rejecting the failed launch.

## Reproduction

From the repository root, use a minimal daemon stub that writes the state produced by a command that failed immediately during startup:

```sh
cat > /tmp/process-launcher-start-crashed-reported-success-probe.mjs <<'EOF'
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startManagedProcess } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const baseDir = await mkdtemp(path.join(os.tmpdir(), "launch-start-crashed-"));
const id = "job";
const result = await startManagedProcess({
  baseDir,
  spec: { id, command: "/bin/false", restart: "never" },
  pollIntervalMs: 1,
  startupTimeoutMs: 100,
  isPidRunning: () => false,
  spawnDaemon: async () => {
    const processDir = path.join(baseDir, id);
    await mkdir(processDir, { recursive: true });
    await writeFile(path.join(processDir, "state.json"), JSON.stringify({
      id,
      command: "/bin/false",
      args: [],
      status: "crashed",
      runtime: "host",
      pid: null,
      restartCount: 0,
      lastExitCode: 1,
      lastStartedAt: new Date().toISOString(),
      lastStoppedAt: new Date().toISOString()
    }));
    return null;
  }
});
console.log(`returnedStatus=${result.state?.status}`);
console.log(`exitCode=${result.state?.lastExitCode}`);
console.log(`daemonPid=${result.daemonPid}`);
EOF

node /tmp/process-launcher-start-crashed-reported-success-probe.mjs

nl -ba packages/process-launcher/src/launcher.ts | sed -n '84,117p;353,372p;411,476p'
```

## Observed Behavior

The start operation fulfills successfully and returns a record proving the requested process already failed:

```text
returnedStatus=crashed
exitCode=1
daemonPid=null
```

`packages/process-launcher/src/launcher.ts:84` through `packages/process-launcher/src/launcher.ts:117` call `waitForRecord()` with a readiness predicate that accepts every state except `restarting`. `packages/process-launcher/src/launcher.ts:353` through `packages/process-launcher/src/launcher.ts:372` return the first record satisfying that predicate, while `packages/process-launcher/src/launcher.ts:411` through `packages/process-launcher/src/launcher.ts:476` represent dead non-zero processes as `crashed`. No branch turns that failed startup state into a rejected start operation.

## Expected Behavior

Starting a managed process should resolve only once the process reaches a successful running state. If startup reaches `crashed` or otherwise terminates before becoming healthy/running, `startManagedProcess()` should reject with diagnostics or an error carrying the failed record.

## Impact

SDK and CLI callers can report successful launch initiation even though the managed command has already failed and no daemon remains. Automation that proceeds after an awaited start may rely on a service that never started, obscuring startup failures and requiring separate state polling to discover an immediately known error.
