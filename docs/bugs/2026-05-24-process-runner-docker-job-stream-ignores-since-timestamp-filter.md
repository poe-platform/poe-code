# Process runner Docker job stream ignores the since timestamp filter

## Summary

The shared `JobHandle.stream()` contract accepts both a byte offset and a `since` timestamp so log consumers can request only recently modified output. The Docker detached-job implementation narrows its local option type to `sinceByte` and never reads `since`, so user-facing Docker job log requests with `--since` still return old log content.

## Reproduction

From the repository root, open a Docker environment through a recording runner, detach it, and request log output with a future `since` timestamp while the fake log-tail command returns existing historical content:

```sh
cat > /tmp/process-runner-docker-job-stream-ignores-since-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { dockerExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const commands = [];
let calls = 0;
const runner = {
  name: "host",
  exec(spec) {
    calls += 1;
    commands.push(spec.args?.join(" ") ?? "");
    const stdout = new PassThrough();
    stdout.end(calls === 1 ? "container-id\n" : "old-log\n");
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
const chunks = [];
for await (const chunk of job.stream({ since: new Date("2099-01-01T00:00:00.000Z") })) {
  chunks.push(chunk);
}
console.log("chunks=" + JSON.stringify(chunks));
console.log("command=" + commands.at(-1));
EOF

node /tmp/process-runner-docker-job-stream-ignores-since-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '100,102p;123,132p'
nl -ba packages/process-runner/src/docker/docker-execution-env.ts | sed -n '460,479p'
nl -ba src/cli/commands/runtime/jobs/shared.ts | sed -n '102,154p'
nl -ba src/cli/commands/runtime/jobs/logs.ts | sed -n '12,39p'
```

## Observed Behavior

Content is returned even though the requested timestamp is far in the future, and the generated Docker command contains no date filter at all:

```text
chunks=[{"byteOffset":0,"data":"old-log\n"}]
command=exec container-id sh -c test -f '/tmp/poe-jobs/container-id.log' && tail -c +1 '/tmp/poe-jobs/container-id.log' || true
```

`packages/process-runner/src/types.ts:123` through `packages/process-runner/src/types.ts:132` expose `stream(opts?: { sinceByte?: number; since?: Date })`. Docker implements only `opts?: { sinceByte?: number }` and tails unconditionally from a byte position at `packages/process-runner/src/docker/docker-execution-env.ts:460` through `packages/process-runner/src/docker/docker-execution-env.ts:479`. The CLI passes parsed `--since` values through `src/cli/commands/runtime/jobs/logs.ts:12` through `src/cli/commands/runtime/jobs/logs.ts:39` and `src/cli/commands/runtime/jobs/shared.ts:102` through `src/cli/commands/runtime/jobs/shared.ts:154`, but the Docker backend discards them.

## Expected Behavior

Docker detached-job log streaming should honor the `since` timestamp contract or reject unsupported filtering clearly. A `--since` request should not silently return older output.

## Impact

Users requesting recent Docker job logs receive stale historical output, which can obscure current failures and produce misleading diagnostic or monitoring output. The same CLI flag behaves differently depending on runtime backend.
