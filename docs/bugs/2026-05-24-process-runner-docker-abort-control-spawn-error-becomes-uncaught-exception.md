# Process runner Docker abort control spawn error becomes an uncaught exception

## Summary

The Docker runner sends cancellation by spawning a separate engine control command without installing an `error` handler on that child process. If the Docker/Podman executable disappears or cannot be spawned after an already-running command is aborted, Node emits an uncaught exception from the stop attempt while the public command handle can still resolve normally.

## Reproduction

From the repository root, use a fake Docker engine whose `run` action renames its own executable before waiting. Once the run is known to have started, abort it so the subsequently spawned stop command cannot find the engine executable:

```sh
cat > /tmp/process-runner-docker-abort-stop-spawn-error-uncaught-probe.mjs <<'EOF'
import { mkdtemp, writeFile, readFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDockerRunner } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "docker-abort-control-spawn-"));
const engine = path.join(dir, "docker");
const started = path.join(dir, "started");
await writeFile(engine, `#!/bin/sh
if [ "$1" = run ]; then mv "$0" "$0.gone"; printf started > '${started}'; sleep 0.05; exit 0; fi
exit 0
`);
await chmod(engine, 0o755);
const controller = new AbortController();
const uncaught = [];
process.on("uncaughtException", (error) => uncaught.push(`${error.code}:${error.syscall}`));
const handle = createDockerRunner({ engine, image: "node:22", containerName: "job" }).exec({
  command: "node",
  signal: controller.signal
});
while (await readFile(started, "utf8").then(() => false, () => true)) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
controller.abort();
console.log("result=" + JSON.stringify(await handle.result));
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("uncaught=" + JSON.stringify(uncaught));
process.exit(0);
EOF

node /tmp/process-runner-docker-abort-stop-spawn-error-uncaught-probe.mjs

nl -ba packages/process-runner/src/docker/docker-runner.ts | sed -n '42,93p;136,160p'
```

## Observed Behavior

The original fake run completes with a normal successful result, while the abort-triggered stop spawn emits an uncaught process exception:

```text
result={"exitCode":0}
uncaught=["ENOENT:spawn /tmp/.../docker"]
```

`packages/process-runner/src/docker/docker-runner.ts:51` through `packages/process-runner/src/docker/docker-runner.ts:53` invoke an abort control command. `packages/process-runner/src/docker/docker-runner.ts:136` through `packages/process-runner/src/docker/docker-runner.ts:143` spawn that process and immediately discard it without an `error` listener, unlike the main run child whose error is handled at `packages/process-runner/src/docker/docker-runner.ts:64` through `packages/process-runner/src/docker/docker-runner.ts:70`.

## Expected Behavior

Failure to launch the Docker stop/kill control command should be contained and reported through a controlled cancellation/error path. It should not surface as an uncaught Node process exception.

## Impact

If the runtime binary becomes unavailable during cancellation, an embedding application can crash while handling shutdown or timeout recovery. The command result channel simultaneously reports success, making the failure both dangerous and misleading.
