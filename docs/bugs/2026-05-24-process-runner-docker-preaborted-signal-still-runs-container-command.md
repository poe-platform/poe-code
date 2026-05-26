# Process runner Docker pre-aborted signal still runs the container command

## Summary

The exported Docker `Runner.exec()` accepts `RunSpec.signal`, but it starts the `docker run` child before it checks whether that signal is already aborted. With a pre-aborted signal, the adapter initiates a stop control command only after spawning the run command; the launched operation can execute side effects and still report exit code `0`.

## Reproduction

From the repository root, use a fake Docker engine that records commands and writes a marker whenever its `run` action executes, then call the runner with an already-aborted signal:

```sh
cat > /tmp/process-runner-docker-preaborted-runs-before-stop-probe.mjs <<'EOF'
import { mkdtemp, writeFile, readFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDockerRunner } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "docker-preabort-"));
const log = path.join(dir, "calls.log");
const marker = path.join(dir, "ran.txt");
const engine = path.join(dir, "docker");
await writeFile(engine, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = run ]; then printf ran > '${marker}'; sleep 0.05; exit 0; fi
exit 1
`);
await chmod(engine, 0o755);
const controller = new AbortController();
controller.abort();
const handle = createDockerRunner({ engine, image: "node:22", containerName: "job" }).exec({
  command: "node",
  signal: controller.signal
});
console.log("result=" + JSON.stringify(await handle.result));
console.log("ran=" + await readFile(marker, "utf8").then(() => "yes", () => "no"));
console.log("calls=" + JSON.stringify((await readFile(log, "utf8")).trim().split("\n")));
EOF

node /tmp/process-runner-docker-preaborted-runs-before-stop-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '16,30p'
nl -ba packages/process-runner/src/docker/docker-runner.ts | sed -n '42,93p;146,160p'
```

## Observed Behavior

The fake container run action executes after cancellation was already final, writes its marker, and returns success. The later stop request cannot prevent that work:

```text
result={"exitCode":0}
ran=yes
calls=["run --rm --name poe-run-job-... node:22 node","stop poe-run-job-..."]
```

`packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:30` expose `RunSpec.signal` as part of the runner operation. `packages/process-runner/src/docker/docker-runner.ts:42` through `packages/process-runner/src/docker/docker-runner.ts:53` spawn the Docker run command before binding the abort signal; only afterward do `packages/process-runner/src/docker/docker-runner.ts:146` through `packages/process-runner/src/docker/docker-runner.ts:160` notice an already-aborted signal and request a stop operation.

## Expected Behavior

An already-aborted Docker execution request should not invoke `docker run` or execute container work. It should return a cancelled/terminated result without starting the command.

## Impact

Cancelled jobs can still modify remote or mounted workspaces, start network activity, or consume container resources during teardown. The Docker runner violates cancellation behavior at precisely the point callers rely on preflight aborts to suppress execution.
