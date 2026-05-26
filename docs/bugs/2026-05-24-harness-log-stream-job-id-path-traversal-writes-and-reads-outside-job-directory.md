# Harness log stream job ID path traversal writes and reads outside the job directory

## Summary

`wrapForLogTee()`, `streamLogFile()`, and `waitForExit()` interpolate `jobId` directly into `/tmp/poe-jobs/<jobId>.(log|exit)` without restricting traversal segments. A job ID containing `../` can therefore redirect detached output and subsequent reads outside the designated job log directory.

## Reproduction

From the repository root, wrap a harmless command with a traversing job ID, execute the generated wrapper, and then read the redirected log and exit file through the same APIs:

```sh
repo=$PWD
rm -f /tmp/poe-log-stream-traversal-probe.log /tmp/poe-log-stream-traversal-probe.exit
cat > /tmp/poe-log-stream-repro.mts <<EOF
import { wrapForLogTee, streamLogFile, waitForExit } from "file://$PWD/packages/agent-harness-tools/src/log-stream.ts";
import { spawn } from "node:child_process";

const jobId = "../poe-log-stream-traversal-probe";
const [command, ...args] = wrapForLogTee(["sh", "-c", "printf external-log"], jobId);
await new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("exit", (code) => code === 0 ? resolve(undefined) : reject(new Error(String(code))));
  child.on("error", reject);
});
const iterator = streamLogFile({}, jobId, {})[Symbol.asyncIterator]();
console.log(JSON.stringify(await iterator.next()));
console.log(JSON.stringify(await waitForExit({}, jobId)));
EOF

"$repo/node_modules/.bin/tsx" /tmp/poe-log-stream-repro.mts
ls -l /tmp/poe-log-stream-traversal-probe.log /tmp/poe-log-stream-traversal-probe.exit
cat /tmp/poe-log-stream-traversal-probe.log
cat /tmp/poe-log-stream-traversal-probe.exit

nl -ba packages/agent-harness-tools/src/log-stream.ts | sed -n '20,104p'
```

## Observed Behavior

The wrapped process writes to `/tmp` outside `/tmp/poe-jobs`, and the streaming/wait APIs load those same external files successfully:

```text
{"value":{"byteOffset":0,"data":"external-log"},"done":false}
{"exitCode":0}
/tmp/poe-log-stream-traversal-probe.log contains: external-log
/tmp/poe-log-stream-traversal-probe.exit contains: 0
```

## Expected Behavior

Detached job identifiers should be encoded as safe single filename components, and log/exit files should remain canonically within `/tmp/poe-jobs`. Traversing IDs should be rejected before command wrapping or reads.

## Impact

Detached job execution can create or overwrite files outside the managed job-log area, and attachment or monitoring can read externally selected log and status files as if they belonged to a managed job.
