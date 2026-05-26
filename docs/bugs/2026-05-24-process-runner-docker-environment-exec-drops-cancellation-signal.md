# Process runner Docker environment exec drops its cancellation signal

## Summary

The Docker `OpenedEnv.exec()` adapter accepts a `RunSpec` with an `AbortSignal`, but when it constructs the host-side `docker exec` command it omits `spec.signal`. Even an already-aborted command request is dispatched to the Docker engine and reports success according to the uncancelled host runner invocation.

## Reproduction

From the repository root, open a Docker environment using a recording host runner, then call `env.exec()` with an already-aborted signal:

```sh
cat > /tmp/process-runner-docker-env-exec-preaborted-runs-command-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { dockerExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const launched = [];
let call = 0;
const runner = {
  name: "host",
  exec(spec) {
    call += 1;
    launched.push({ args: spec.args, aborted: spec.signal?.aborted ?? null });
    const stdout = new PassThrough();
    if (call === 1) stdout.end("container-id\n");
    else stdout.end();
    return {
      pid: 1,
      stdin: null,
      stdout,
      stderr: new PassThrough(),
      result: Promise.resolve({ exitCode: spec.signal?.aborted ? 130 : 0 }),
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
const controller = new AbortController();
controller.abort();
const handle = env.exec({ command: "node", args: ["app.js"], signal: controller.signal });
console.log("result=" + JSON.stringify(await handle.result));
console.log("launched=" + JSON.stringify(launched));
EOF

node /tmp/process-runner-docker-env-exec-preaborted-runs-command-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '16,30p;112,121p'
nl -ba packages/process-runner/src/docker/docker-execution-env.ts | sed -n '210,228p'
```

## Observed Behavior

The second host-runner invocation executes `docker exec` with no forwarded signal, so the pre-aborted operation reports success:

```text
result={"exitCode":0}
launched=[{"args":["run","-d","-i","--name","poe-env-...","node:22","sh","-c","while :; do sleep 3600; done"],"aborted":null},{"args":["exec","container-id","node","app.js"],"aborted":null}]
```

`packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:30` specify the cancellation signal on executable requests, and `packages/process-runner/src/types.ts:112` through `packages/process-runner/src/types.ts:121` expose `OpenedEnv.exec(spec)`. `packages/process-runner/src/docker/docker-execution-env.ts:210` through `packages/process-runner/src/docker/docker-execution-env.ts:228` translate command and stream options into a host-side Docker invocation but omit `signal: spec.signal`.

## Expected Behavior

The Docker environment adapter should forward cancellation to the host runner used for `docker exec`, so an already-aborted command is not dispatched into the container.

## Impact

Cancelled Docker-environment executions can still run arbitrary commands inside a retained workspace container. Higher-level timeout and shutdown handling cannot reliably prevent side effects once work is routed through `OpenedEnv.exec()`.
