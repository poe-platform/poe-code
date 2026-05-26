# Launch run follows a symlinked process directory and executes an external specification

## Summary

`runManagedProcess()` loads `spec.json` from a process directory resolved with an uncontained textual join. If a valid process-id directory is a symlink to an external directory, the hidden launcher runner reads and executes the external specification, while also writing launcher state into that external directory.

## Reproduction

From the repository root, create a disposable launch root whose `job` entry points to an external directory containing a harmless marker command:

```sh
repo=$PWD
probe=$(mktemp -d)
base="$probe/launch"
outside="$probe/outside"
mkdir -p "$base" "$outside"
ln -s "$outside" "$base/job"

cat > "$outside/spec.json" <<EOF
{"id":"job","command":"/bin/sh","args":["-c","printf executed > '$probe/executed.txt'"],"restart":"never"}
EOF

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { runManagedProcess } from "file://$PWD/packages/process-launcher/src/index.ts";

await runManagedProcess({ baseDir: "$base", id: "job", pollIntervalMs: 1 });
console.log("executed=" + await readFile("$probe/executed.txt", "utf8"));
console.log("state=" + String(await stat("$outside/state.json").then(() => true, () => false)));
console.log("meta=" + String(await stat("$outside/meta.json").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '305,350p;555,624p'
```

## Observed Behavior

The exported runner executes the command loaded through `launch/job -> outside` and writes runtime state into that same external target:

```text
executed=executed
state=true
meta=true
```

The process id is a normal safe-looking string; execution escapes the managed launch root solely through the symlinked process directory.

## Expected Behavior

The launch daemon should only load and execute specifications stored beneath the canonical launch-state root. A process directory that resolves outside that root should be rejected before reading a spec or spawning any command.

## Impact

A crafted symlink in launch storage can turn invocation of a valid managed-process id into execution of an externally stored specification. This is an execution-boundary bypass independent of textual path traversal in the id.
