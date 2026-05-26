# Launch follows a symlinked log directory and reads or appends output outside process state

## Summary

Managed launch logging resolves output beneath `<baseDir>/<id>/logs`, but does not reject a symbolic link at the nested `logs` directory. Even when the managed process directory and specification are local, `readManagedLogs()` reads external files and `runManagedProcess()` appends new process output into the external target.

## Reproduction

From the repository root, create a local managed process record whose `logs` directory points outside launch state, seed external output, and execute the local specification through exported APIs:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/launch/job" "$probe/outside"
ln -s "$probe/outside" "$probe/launch/job/logs"
printf 'external-prior\n' > "$probe/outside/stdout.log"
cat > "$probe/launch/job/spec.json" <<EOF
{"id":"job","command":"/bin/sh","args":["-c","printf 'local-live\\n'"],"restart":"never","logRetainCount":2}
EOF

cat > "$probe/repro.mts" <<EOF
import { readManagedLogs, runManagedProcess } from "file://$PWD/packages/process-launcher/src/index.ts";
console.log("before=" + JSON.stringify(await readManagedLogs({ baseDir: "$probe/launch", id: "job" })));
await runManagedProcess({ baseDir: "$probe/launch", id: "job", pollIntervalMs: 1 });
console.log("after=" + JSON.stringify(await readManagedLogs({ baseDir: "$probe/launch", id: "job" })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/launch/job/logs"
cat "$probe/outside/stdout.log"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '244,252p;305,350p;617,628p'
nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '23,30p;100,114p'
nl -ba packages/process-launcher/src/logs/log-writer.ts | sed -n '9,14p;109,150p'
```

## Observed Behavior

The log reader returns externally seeded content through the local process path, and running the locally stored specification appends its output to the same external file:

```text
<probe>/launch/job/logs -> <probe>/outside
before=["external-prior"]
after=["external-prior","local-live"]
<probe>/outside/stdout.log contains:
external-prior
local-live
```

`resolveLogDir()` joins the expected nested directory textually. `createLogWriter()` then performs reads and appends on `stdout.log` below that path without validating the canonical location of the log directory.

## Expected Behavior

Managed-process logging should remain canonically within each local process state directory. A nested log directory that resolves outside `<baseDir>/<id>` should be rejected before reading or writing logs.

## Impact

A symlink contained inside otherwise legitimate managed-process state can disclose external text as launch output and redirect process logs outside the expected state boundary. This enables external file modification through routine process execution without requiring a symlinked process directory or a traversal-based id.
