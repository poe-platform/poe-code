# Process launcher start daemon spawn rejection leaves a restarting record

## Summary

The exported `startManagedProcess()` API persists a new process specification, bootstrap `restarting` state, and null daemon metadata before calling the injected `spawnDaemon()` function. If daemon spawning rejects, the start operation propagates the error but leaves behind a saved managed-process record that claims startup is still in progress even though no daemon was created.

## Reproduction

From the repository root, start a managed process with a daemon launcher that rejects before returning any PID:

```sh
cat > /tmp/process-launcher-start-spawn-rejection-leaves-bootstrap-probe.mjs <<'EOF'
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startManagedProcess } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const baseDir = await mkdtemp(path.join(os.tmpdir(), "launch-spawn-reject-"));
let error;
try {
  await startManagedProcess({
    baseDir,
    spec: { id: "job", command: "server", restart: "never" },
    spawnDaemon: async () => { throw new Error("daemon spawn denied"); }
  });
} catch (caught) {
  error = caught.message;
}
console.log("error=" + error);
console.log("state=" + await readFile(path.join(baseDir, "job", "state.json"), "utf8"));
console.log("meta=" + await readFile(path.join(baseDir, "job", "meta.json"), "utf8"));
EOF

node /tmp/process-launcher-start-spawn-rejection-leaves-bootstrap-probe.mjs

nl -ba packages/process-launcher/src/launcher.ts | sed -n '84,117p;464,476p;563,615p'
```

## Observed Behavior

The daemon launch error rejects the API call, but a durable record remains in the startup state with no daemon PID:

```text
error=daemon spawn denied
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
  "daemonPid": null
}
```

`packages/process-launcher/src/launcher.ts:84` through `packages/process-launcher/src/launcher.ts:117` write the spec, bootstrap state, and empty metadata before awaiting `spawnDaemon()`, without cleanup in the rejection path. `packages/process-launcher/src/launcher.ts:464` through `packages/process-launcher/src/launcher.ts:476` define that bootstrap state as `restarting`, and `packages/process-launcher/src/launcher.ts:563` through `packages/process-launcher/src/launcher.ts:615` persist it immediately.

## Expected Behavior

If no daemon can be spawned, startup should reject without leaving a pending-looking launch record, or it should persist an explicit failed terminal state describing daemon launch failure.

## Impact

Ordinary daemon spawn errors create phantom startup records that appear to be recovering or starting despite having no execution process. They clutter launch listings, require manual removal, and conceal the difference between a running startup and a launch that never occurred.
