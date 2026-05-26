# Process launcher run with a pre-aborted signal still launches the command

## Summary

The exported `runManagedProcess()` API accepts an `AbortSignal`, but it does not handle a signal that is already aborted before the function is called. It attaches only an abort event listener, constructs a fresh non-aborted internal controller, and launches the configured command before it ever checks whether execution should have been cancelled.

## Reproduction

From the repository root, create a managed-process specification that writes a marker file, abort its signal before invoking `runManagedProcess()`, and then run it:

```sh
cat > /tmp/process-launcher-run-preaborted-signal-starts-child-probe.mjs <<'EOF'
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runManagedProcess } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const baseDir = await mkdtemp(path.join(os.tmpdir(), "launch-run-abort-"));
const dir = path.join(baseDir, "job");
const marker = path.join(baseDir, "ran.txt");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "spec.json"), JSON.stringify({
  id: "job",
  command: "/bin/sh",
  args: ["-c", `printf ran > '${marker}'`],
  restart: "never"
}));
const controller = new AbortController();
controller.abort();
await runManagedProcess({ baseDir, id: "job", signal: controller.signal, pollIntervalMs: 1 });
console.log("ran=" + await readFile(marker, "utf8").then(() => "yes", () => "no"));
console.log("meta=" + await readFile(path.join(dir, "meta.json"), "utf8"));
EOF

node /tmp/process-launcher-run-preaborted-signal-starts-child-probe.mjs

nl -ba packages/process-launcher/src/launcher.ts | sed -n '305,351p'
nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '45,69p;109,157p'
```

## Observed Behavior

Even though cancellation was requested before invocation, the configured command executes and writes its marker file:

```text
ran=yes
meta={
  "daemonPid": null
}
```

`packages/process-launcher/src/launcher.ts:305` through `packages/process-launcher/src/launcher.ts:351` only register an event handler on the external signal; they do not copy an already-aborted state into the internal controller before invoking `supervisor.start()`. `packages/process-launcher/src/supervisor/supervisor.ts:45` through `packages/process-launcher/src/supervisor/supervisor.ts:69` likewise only listen for future abort events and proceed into launch, while `packages/process-launcher/src/supervisor/supervisor.ts:109` through `packages/process-launcher/src/supervisor/supervisor.ts:157` start the child normally.

## Expected Behavior

An already-aborted `runManagedProcess()` request should not start the configured process or write daemon lifecycle state beyond controlled cancellation handling. It should return or reject as cancelled without executing work.

## Impact

Shutdown paths, timed-out callers, and cancelled orchestration can execute commands after cancellation was already final. This can trigger unintended side effects, duplicate work, or long-running processes during application teardown.
