# Process runner Docker interactive shell ignores the shell working directory

## Summary

The Docker execution environment accepts `shellSpec.cwd` but always constructs interactive `docker exec` commands with the environment workspace directory. A caller requesting a shell in another container path receives an interactive command launched with the wrong `-w` directory.

## Reproduction

From the repository root, open a Docker environment with `/outer` as its workspace and configure its interactive shell specification to use `/inner`. Capture the generated engine invocation:

```sh
cat > /tmp/process-runner-docker-shell-ignores-shellspec-cwd-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { dockerExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const calls = [];
const runner = {
  name: "host",
  exec(spec) {
    calls.push(spec.args);
    const stdout = new PassThrough();
    stdout.end(calls.length === 1 ? "container-id\n" : "");
    return { pid: 1, stdin: null, stdout, stderr: new PassThrough(), result: Promise.resolve({ exitCode: 0 }), kill() {} };
  }
};
const env = await dockerExecutionEnvFactory.open({
  cwd: "/outer",
  runtime: { type: "docker", image: "node:22", engine: "docker" },
  env: {},
  uploadIgnoreFiles: [],
  jobLabel: { tool: "x", argv: [] },
  hostRunner: runner,
  shellSpec: { command: "bash", args: ["-lc", "pwd"], cwd: "/inner" }
});
await env.shell().result;
console.log("shellArgs=" + JSON.stringify(calls.at(-1)));
EOF

node /tmp/process-runner-docker-shell-ignores-shellspec-cwd-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '16,30p;61,70p;112,121p'
nl -ba packages/process-runner/src/docker/docker-execution-env.ts | sed -n '210,245p'
```

## Observed Behavior

The generated interactive Docker command uses `-w /outer`, discarding the shell's requested `/inner` directory:

```text
shellArgs=["exec","-i","-t","-w","/outer","container-id","bash","-lc","pwd"]
```

`packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:30` and `packages/process-runner/src/types.ts:61` through `packages/process-runner/src/types.ts:70` expose `shellSpec.cwd`. `packages/process-runner/src/docker/docker-execution-env.ts:233` through `packages/process-runner/src/docker/docker-execution-env.ts:245` substitute `input.spec.cwd`, and its `exec()` adapter turns that value into `docker exec -w` at `packages/process-runner/src/docker/docker-execution-env.ts:210` through `packages/process-runner/src/docker/docker-execution-env.ts:228`.

## Expected Behavior

Docker interactive shell execution should honor an explicit `shellSpec.cwd`, using the environment workspace only as a default when no shell working directory is requested.

## Impact

Interactive Docker sessions can open outside the selected subproject or tool working directory inside the container. Commands and edits may target an unintended workspace even though the requested shell specification contained the correct location.
