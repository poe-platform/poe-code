# Process runner host interactive shell ignores the shell working directory

## Summary

The host execution environment accepts a `shellSpec` that is itself a complete `RunSpec`, including `cwd`, but `shell()` always launches in the outer environment's `openSpec.cwd`. A caller requesting an interactive command in a different working directory executes from the wrong project location.

## Reproduction

From the repository root, open a host environment rooted at one directory and provide an interactive shell specification rooted at a second directory. Have the shell record its actual working directory:

```sh
cat > /tmp/process-runner-host-shell-ignores-shellspec-cwd-probe.mjs <<'EOF'
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hostExecutionEnvFactory } from "/Users/kjopek/Workspace/poe-code/packages/process-runner/dist/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "host-shell-cwd-"));
const outer = path.join(root, "outer");
const inner = path.join(root, "inner");
await mkdir(outer);
await mkdir(inner);
const marker = path.join(root, "pwd.txt");
const env = await hostExecutionEnvFactory.open({
  cwd: outer,
  runtime: { type: "host" },
  env: process.env,
  uploadIgnoreFiles: [],
  jobLabel: { tool: "test", argv: [] },
  shellSpec: { command: "/bin/sh", args: ["-c", `pwd > '${marker}'`], cwd: inner }
});
console.log("result=" + JSON.stringify(await env.shell().result));
console.log("pwd=" + (await readFile(marker, "utf8")).trim());
console.log("expected=" + inner);
EOF

node /tmp/process-runner-host-shell-ignores-shellspec-cwd-probe.mjs

nl -ba packages/process-runner/src/types.ts | sed -n '16,30p;61,70p;112,121p'
nl -ba packages/process-runner/src/host/host-execution-env.ts | sed -n '31,43p'
```

## Observed Behavior

The interactive shell completes successfully but runs from the environment's outer directory instead of the directory requested by `shellSpec`:

```text
result={"exitCode":0}
pwd=/tmp/.../outer
expected=/tmp/.../inner
```

`packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:30` define `RunSpec.cwd`, and `packages/process-runner/src/types.ts:61` through `packages/process-runner/src/types.ts:70` permit a full `RunSpec` as `shellSpec`. `packages/process-runner/src/host/host-execution-env.ts:31` through `packages/process-runner/src/host/host-execution-env.ts:43` use `openSpec.cwd` unconditionally rather than `shellSpec.cwd` when supplied.

## Expected Behavior

An interactive shell specification with an explicit `cwd` should launch in that requested directory, falling back to the environment directory only when the shell does not provide one.

## Impact

Interactive host agents can run against the wrong checkout or configuration directory, producing edits, commands, and terminal context in a different project than the caller selected.
