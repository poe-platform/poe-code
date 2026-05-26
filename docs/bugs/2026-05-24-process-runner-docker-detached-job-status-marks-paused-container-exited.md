# Process runner Docker detached job status marks a paused container exited

## Summary

The Docker detached-job `status()` implementation maps only an exact engine status of `running` to the public running state and maps every other successful inspection result to `exited`. A Docker container in the live-but-paused state is therefore reported as completed even though it has not exited and can later be resumed.

## Reproduction

From the repository root, use a recording runner that returns a valid container ID during environment opening and returns Docker's `paused` state during detached job status inspection:

```sh
cat > /tmp/process-runner-docker-job-paused-status-reported-exited-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { dockerExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

let calls = 0;
const runner = {
  name: "host",
  exec() {
    calls += 1;
    const stdout = new PassThrough();
    if (calls === 1) stdout.end("container-id\n");
    else stdout.end("paused\n");
    return {
      pid: 1,
      stdin: null,
      stdout,
      stderr: new PassThrough(),
      result: Promise.resolve({ exitCode: 0 }),
      kill() {}
    };
  }
};
const env = await dockerExecutionEnvFactory.open({
  cwd: "/workspace",
  runtime: { type: "docker", image: "node:22", engine: "docker" },
  env: {},
  uploadIgnoreFiles: [],
  jobLabel: { tool: "x", argv: [] },
  hostRunner: runner
});
const job = await env.detach();
console.log("status=" + await job.status());
EOF

node /tmp/process-runner-docker-job-paused-status-reported-exited-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '37,44p;123,132p'
nl -ba packages/process-runner/src/docker/docker-execution-env.ts | sed -n '428,459p'
```

## Observed Behavior

An engine status explicitly indicating that the container is paused is exposed as if the detached job had exited:

```text
status=exited
```

`packages/process-runner/src/docker/docker-execution-env.ts:440` through `packages/process-runner/src/docker/docker-execution-env.ts:459` inspect Docker state but compare the output only to the single text `running`; any other successful output becomes `exited`. A paused Docker container remains an existing, resumable live environment, not a completed process.

## Expected Behavior

Detached job status should distinguish paused/unavailable live container states from terminal exit, or conservatively report a non-terminal/unknown state rather than declaring completion without evidence that execution exited.

## Impact

Paused Docker jobs can be treated as completed by job-management flows, triggering premature sync, cleanup, or misleading user output while the resumable container and its in-progress workspace still exist.
