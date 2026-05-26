# Process state store follows a symlinked state file and reads or rewrites an external record

## Summary

The exported process-launcher `createStateStore()` API reads and writes `<stateDir>/<id>/state.json`, but does not reject a symbolic link at the individual state file. If an otherwise local process directory contains `state.json` linked externally, `read()` treats external JSON as managed state and `write()` overwrites that external record.

## Reproduction

From the repository root, create a local process directory whose state file points to an external JSON document and use the public state-store API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/launch/job" "$probe/outside"
printf '{"id":"job","status":"stopped","command":"/bin/true","args":[],"restartCount":0,"pid":null,"lastExitCode":null}\n' > "$probe/outside/state.json"
ln -s "$probe/outside/state.json" "$probe/launch/job/state.json"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { createStateStore } from "file://$PWD/packages/process-launcher/src/index.ts";

const store = createStateStore("$probe/launch");
console.log("read=" + JSON.stringify(await store.read("job")));
await store.write("job", {
  id: "job",
  command: "/bin/echo",
  args: ["external"],
  status: "running",
  pid: 123,
  restartCount: 1,
  lastExitCode: null
});
console.log("external=" + await readFile("$probe/outside/state.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/launch/job/state.json"

nl -ba packages/process-launcher/src/state/state-store.ts | sed -n '45,75p'
```

## Observed Behavior

The state store reads the external JSON through the local-looking link and then overwrites the external target with the new managed-process state:

```text
<probe>/launch/job/state.json -> <probe>/outside/state.json
read={"id":"job","status":"stopped","command":"/bin/true",...}
external={
  "id": "job",
  "command": "/bin/echo",
  "args": ["external"],
  "status": "running",
  "pid": 123,
  "restartCount": 1,
  "lastExitCode": null
}
```

`createStateStore().read()` and `.write()` both join `state.json` beneath the supplied process directory and use ordinary file I/O without validating the canonical state-file location.

## Expected Behavior

Managed process state should be read and written only from canonical files beneath the configured state directory. A symlinked `state.json` file escaping the local process directory should be rejected rather than trusted or overwritten.

## Impact

Local process state operations can disclose or corrupt an arbitrary external JSON file through a single in-tree symlink, without requiring a symlinked process directory or an unsafe process id. External state can also be presented as authoritative launch status to callers.
