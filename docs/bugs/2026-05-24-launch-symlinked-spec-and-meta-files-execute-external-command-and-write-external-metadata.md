# Launch follows symlinked spec and meta files to execute external commands and write external metadata

## Summary

`runManagedProcess()` reads `spec.json` and writes `meta.json` below an otherwise local managed-process directory, but does not reject symbolic links at either file. A local process entry can therefore execute a specification loaded from an external file and persist daemon metadata to another external file without symlinking the entire process directory.

## Reproduction

From the repository root, create a local process directory with only its specification and metadata entries redirected outside launch state, then run it through the public launcher API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/launch/job" "$probe/outside"
cat > "$probe/outside/spec.json" <<EOF
{"id":"job","command":"/bin/sh","args":["-c","printf spec-executed > '$probe/executed.txt'"],"restart":"never"}
EOF
ln -s "$probe/outside/spec.json" "$probe/launch/job/spec.json"
ln -s "$probe/outside/meta.json" "$probe/launch/job/meta.json"

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { runManagedProcess } from "file://$PWD/packages/process-launcher/src/index.ts";

await runManagedProcess({ baseDir: "$probe/launch", id: "job", pollIntervalMs: 1 });
console.log("executed=" + await readFile("$probe/executed.txt", "utf8"));
console.log("externalMeta=" + String(await stat("$probe/outside/meta.json").then(() => true, () => false)));
console.log(await readFile("$probe/outside/meta.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/launch/job/spec.json" "$probe/launch/job/meta.json"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '305,350p;555,635p'
```

## Observed Behavior

The launcher executes the external specification through the local `job/spec.json` link and writes final metadata through the independent local `job/meta.json` link:

```text
<probe>/launch/job/spec.json -> <probe>/outside/spec.json
<probe>/launch/job/meta.json -> <probe>/outside/meta.json
executed=spec-executed
externalMeta=true
{
  "daemonPid": null
}
```

`readSpec()` and `writeMeta()` join their expected filenames beneath the selected process directory, then call generic JSON read/write functions without canonical containment checks for either file.

## Expected Behavior

Managed launch control files should be read and written only from canonical files beneath the configured process directory. Symlinked `spec.json` or `meta.json` entries escaping local process state should be rejected before executing a specification or persisting metadata.

## Impact

A local managed-process entry can redirect the executable launch specification to external content and write daemon metadata outside managed storage using only individual file links. This bypasses protections that might reject a symlinked whole process directory while still enabling command execution and external state mutation.
