# Process runner Docker abort stop failure returns a successful command result

## Summary

When a Docker run is cancelled, the runner launches `docker stop` as an unobserved control process and settles the public result only from the original `docker run` child. If the stop command fails while the original container command exits successfully, the aborted run resolves as `{ exitCode: 0 }`, hiding that cancellation was not successfully enforced.

## Reproduction

From the repository root, use a fake Docker engine whose run operation succeeds after a brief delay but whose stop control operation exits with failure, then abort the run:

```sh
cat > /tmp/process-runner-docker-abort-stop-failure-reports-normal-success-probe.mjs <<'EOF'
import { mkdtemp, writeFile, readFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDockerRunner } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "docker-abort-stop-fail-"));
const log = path.join(dir, "calls.log");
const engine = path.join(dir, "docker");
await writeFile(engine, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = run ]; then sleep 0.05; exit 0; fi
exit 42
`);
await chmod(engine, 0o755);
const controller = new AbortController();
const handle = createDockerRunner({ engine, image: "node:22", containerName: "job" }).exec({
  command: "node",
  signal: controller.signal
});
controller.abort();
console.log("result=" + JSON.stringify(await handle.result));
console.log("calls=" + JSON.stringify((await readFile(log, "utf8")).trim().split("\n")));
EOF

node /tmp/process-runner-docker-abort-stop-failure-reports-normal-success-probe.mjs

nl -ba packages/process-runner/src/docker/docker-runner.ts | sed -n '42,93p;136,160p'
nl -ba packages/process-runner/src/types.ts | sed -n '3,30p'
```

## Observed Behavior

The stop command is attempted and fails in the fake engine, but the public run result still reports normal success:

```text
result={"exitCode":0}
calls=["run --rm --name poe-run-job-... node:22 node","stop poe-run-job-..."]
```

`packages/process-runner/src/docker/docker-runner.ts:51` through `packages/process-runner/src/docker/docker-runner.ts:53` dispatch stop on abort through `spawnControlCommand()`. `packages/process-runner/src/docker/docker-runner.ts:54` through `packages/process-runner/src/docker/docker-runner.ts:70` settle the exposed result only from the original run process. `packages/process-runner/src/docker/docker-runner.ts:136` through `packages/process-runner/src/docker/docker-runner.ts:143` do not listen for or incorporate control-command exit status.

## Expected Behavior

Cancellation should expose failure to stop the running container, or otherwise provide a controlled indication that an abort request was not enforced. An aborted run should not report uncomplicated success solely because the original command eventually completed.

## Impact

Callers can believe a cancellation succeeded while an unwanted container continues running or completes side effects. Timeout and shutdown workflows lose the information needed to escalate termination or alert operators.
