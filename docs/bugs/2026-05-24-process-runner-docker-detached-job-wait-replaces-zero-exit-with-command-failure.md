# Process runner Docker detached job wait replaces a zero exit code with command failure

## Summary

The Docker detached-job `wait()` method parses the engine's reported container exit code and falls back using JavaScript truthiness. Because exit code `0` is falsy, a valid successful wait output is discarded whenever the local `docker wait` invocation itself has a non-zero process result, causing a successful container completion to be reported as failure.

## Reproduction

From the repository root, use a recording runner whose detached wait invocation outputs the valid completed-container code `0` but whose wrapper process reports exit code `7`:

```sh
cat > /tmp/process-runner-docker-job-wait-zero-exit-code-falls-back-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { dockerExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

let calls = 0;
const runner = {
  name: "host",
  exec() {
    calls += 1;
    const stdout = new PassThrough();
    stdout.end(calls === 1 ? "container-id\n" : "0\n");
    return {
      pid: 1,
      stdin: null,
      stdout,
      stderr: new PassThrough(),
      result: Promise.resolve({ exitCode: calls === 1 ? 0 : 7 }),
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
console.log("wait=" + JSON.stringify(await job.wait()));
EOF

node /tmp/process-runner-docker-job-wait-zero-exit-code-falls-back-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '123,132p'
nl -ba packages/process-runner/src/docker/docker-execution-env.ts | sed -n '480,490p'
```

## Observed Behavior

Although the wait output explicitly reports successful completion as `0`, the job API returns the wrapper process's non-zero result instead:

```text
wait={"exitCode":7}
```

`packages/process-runner/src/docker/docker-execution-env.ts:480` through `packages/process-runner/src/docker/docker-execution-env.ts:490` calculate the result as `Number.parseInt(stdout.trim(), 10) || result.exitCode`. That expression cannot preserve a valid parsed exit code of `0`, because it always selects the fallback result in that case.

## Expected Behavior

A successfully parsed Docker wait exit code, including `0`, should be returned as the detached job's completion result. The host command status should be used only when no valid container exit code was obtained or the invocation must be surfaced as an error.

## Impact

Successful detached Docker jobs can be reported as failed, causing incorrect CI results, erroneous retry decisions, and misleading user-visible completion status whenever the wrapper command result disagrees with a valid zero output.
