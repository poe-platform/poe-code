# Process runner Docker interactive shell drops its cancellation signal

## Summary

The Docker execution environment accepts an interactive `shellSpec` with a `RunSpec.signal`, but `shell()` constructs a new execution request without forwarding that signal. An already-aborted Docker interactive session is therefore dispatched through `docker exec` as an uncancelled command and reports success.

## Reproduction

From the repository root, open a Docker environment through a recording runner with a pre-aborted shell specification, then start the shell:

```sh
cat > /tmp/process-runner-docker-shell-preaborted-signal-runs-command-probe.mjs <<'EOF'
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
    if (call === 1) stdout.end("container-id\n"); else stdout.end();
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
const controller = new AbortController();
controller.abort();
const env = await dockerExecutionEnvFactory.open({
  cwd: "/workspace",
  runtime: { type: "docker", image: "node:22", engine: "docker" },
  env: {},
  uploadIgnoreFiles: [],
  jobLabel: { tool: "x", argv: [] },
  hostRunner: runner,
  shellSpec: { command: "bash", args: ["-lc", "echo ok"], signal: controller.signal }
});
const handle = env.shell();
console.log("result=" + JSON.stringify(await handle.result));
console.log("launched=" + JSON.stringify(launched));
EOF

node /tmp/process-runner-docker-shell-preaborted-signal-runs-command-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '16,30p;61,70p;112,121p'
nl -ba packages/process-runner/src/docker/docker-execution-env.ts | sed -n '210,245p'
```

## Observed Behavior

The interactive `docker exec` invocation is sent without a signal and completes successfully despite the shell having been cancelled before launch:

```text
result={"exitCode":0}
launched=[{"args":["run","-d","-i","--name","poe-env-...","node:22","sh","-c","while :; do sleep 3600; done"],"aborted":null},{"args":["exec","-i","-t","-w","/workspace","container-id","bash","-lc","echo ok"],"aborted":null}]
```

`packages/process-runner/src/types.ts:61` through `packages/process-runner/src/types.ts:70` allow interactive `shellSpec` to carry `RunSpec.signal`. `packages/process-runner/src/docker/docker-execution-env.ts:233` through `packages/process-runner/src/docker/docker-execution-env.ts:245` omit that signal when converting the shell specification into `this.exec(...)`, and `packages/process-runner/src/docker/docker-execution-env.ts:210` through `packages/process-runner/src/docker/docker-execution-env.ts:228` likewise dispatch a Docker command without cancellation.

## Expected Behavior

Docker interactive shell requests should preserve `shellSpec.signal` through the `docker exec` adapter so pre-cancelled sessions do not run commands in the container.

## Impact

Cancelled interactive agent or sandbox sessions can still start commands inside Docker workspaces, causing side effects after UI cancellation or shutdown logic has already declared the session abandoned.
