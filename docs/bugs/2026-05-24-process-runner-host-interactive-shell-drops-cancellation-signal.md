# Process runner host interactive shell drops its cancellation signal

## Summary

The host execution environment accepts an interactive `shellSpec` containing a `RunSpec.signal`, but its `shell()` implementation reconstructs the run request without copying that signal. An already-aborted interactive shell launch therefore executes the configured local command rather than being cancelled by the host runner.

## Reproduction

From the repository root, open a host execution environment with a pre-aborted shell specification whose command writes a marker file, then launch its shell:

```sh
cat > /tmp/process-runner-host-shell-preaborted-signal-runs-command-probe.mjs <<'EOF'
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hostExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "host-shell-preabort-"));
const marker = path.join(dir, "ran.txt");
const controller = new AbortController();
controller.abort();
const env = await hostExecutionEnvFactory.open({
  cwd: dir,
  runtime: { type: "host" },
  env: { PATH: process.env.PATH ?? "" },
  uploadIgnoreFiles: [],
  jobLabel: { tool: "test", argv: [] },
  shellSpec: {
    command: "/bin/sh",
    args: ["-c", `printf ran > '${marker}'`],
    signal: controller.signal
  }
});
const handle = env.shell();
console.log("result=" + JSON.stringify(await handle.result));
console.log("ran=" + await readFile(marker, "utf8").then(() => "yes", () => "no"));
EOF

node /tmp/process-runner-host-shell-preaborted-signal-runs-command-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '16,30p;61,70p;112,121p'
nl -ba packages/process-runner/src/host/host-execution-env.ts | sed -n '25,44p'
nl -ba packages/process-runner/src/host/host-runner.ts | sed -n '18,27p;44,88p'
```

## Observed Behavior

The pre-cancelled interactive request completes successfully and executes the marker-writing command:

```text
result={"exitCode":0}
ran=yes
```

`packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:30` and `packages/process-runner/src/types.ts:61` through `packages/process-runner/src/types.ts:70` allow `shellSpec` to carry the same `signal` supported by run operations. `packages/process-runner/src/host/host-execution-env.ts:31` through `packages/process-runner/src/host/host-execution-env.ts:42` forward command, args, cwd, env, and TTY settings but omit `shellSpec.signal`. The underlying host runner would honor an aborted signal at `packages/process-runner/src/host/host-runner.ts:44` through `packages/process-runner/src/host/host-runner.ts:88` if it received one.

## Expected Behavior

Interactive host shell execution should forward the cancellation signal from `shellSpec` into the underlying runner so a pre-aborted launch does not execute the requested command.

## Impact

Cancelled interactive agent sessions on the host runtime can still start local binaries and modify workspaces. This breaks cancellation for interactive flows even though synchronous host execution supports it.
