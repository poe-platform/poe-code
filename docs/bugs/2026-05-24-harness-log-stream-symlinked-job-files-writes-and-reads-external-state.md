# Harness log stream follows symlinked job files and writes or reads external state

## Summary

The detached log helpers use `/tmp/poe-jobs/<jobId>.log` and `.exit` as ordinary file paths without rejecting symbolic links at those files. Even with a safe job ID, log streaming can read external content, exit polling can accept external status, and wrapped output can overwrite an external log target.

## Reproduction

From the repository root, create ordinary `safe-probe` log and exit entries as symlinks to external files, read them through the helper APIs, and then launch a harmless wrapped command through the linked log file:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p /tmp/poe-jobs
printf 'external-log' > "$probe/outside.log"
printf '7\n' > "$probe/outside.exit"
rm -f /tmp/poe-jobs/safe-probe.log /tmp/poe-jobs/safe-probe.exit
ln -s "$probe/outside.log" /tmp/poe-jobs/safe-probe.log
ln -s "$probe/outside.exit" /tmp/poe-jobs/safe-probe.exit

cat > "$probe/repro.mts" <<EOF
import { wrapForLogTee, streamLogFile, waitForExit } from "file://$PWD/packages/agent-harness-tools/src/log-stream.ts";
import { spawn } from "node:child_process";

console.log(JSON.stringify(await streamLogFile({}, "safe-probe", {})[Symbol.asyncIterator]().next()));
console.log(JSON.stringify(await waitForExit({}, "safe-probe")));

const [command, ...args] = wrapForLogTee(["sh", "-c", "printf overwritten"], "safe-probe");
await new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("exit", (code) => code === 0 ? resolve(undefined) : reject(new Error(String(code))));
  child.on("error", reject);
});
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l /tmp/poe-jobs/safe-probe.log /tmp/poe-jobs/safe-probe.exit
cat "$probe/outside.log"

nl -ba packages/agent-harness-tools/src/log-stream.ts | sed -n '20,104p;123,151p'
```

## Observed Behavior

The APIs read the external symlink targets as managed job output and status, and the wrapped process overwrites the external log file through the linked local entry:

```text
{"value":{"byteOffset":0,"data":"external-log"},"done":false}
{"exitCode":7}
/tmp/poe-jobs/safe-probe.log -> <probe>/outside.log
<probe>/outside.log contains: overwritten
```

The wrapper's exit-file `mv` replaces the local `.exit` symlink entry, but this does not prevent prior or standalone `waitForExit()` reads from following an external exit file.

## Expected Behavior

Managed detached job logs and exit files should be regular canonical files contained within `/tmp/poe-jobs`. Existing symlinked entries that escape that directory should be rejected before output writes or status/log reads.

## Impact

An ordinary managed job identifier can disclose external file content as job output or status and overwrite an external file with subprocess output, without needing path traversal in the identifier itself.
