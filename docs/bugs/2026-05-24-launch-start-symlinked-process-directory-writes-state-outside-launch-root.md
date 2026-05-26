# Launch start follows a symlinked process directory and writes outside launch state

## Summary

`startManagedProcess()` accepts an ordinary process id but does not verify that the resulting process directory remains within `baseDir` after symlink resolution. If `<baseDir>/<id>` is a symlink to an external directory, starting that id writes `spec.json`, `state.json`, and `meta.json` into the external target.

## Reproduction

From the repository root, invoke the exported launcher SDK against a disposable launch state directory containing a symlinked process entry:

```sh
repo=$PWD
probe=$(mktemp -d)
base="$probe/launch"
outside="$probe/outside"
mkdir -p "$base" "$outside"
ln -s "$outside" "$base/api"

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { startManagedProcess } from "file://$PWD/packages/process-launcher/src/index.ts";

await startManagedProcess({
  baseDir: "$base",
  spec: { id: "api", command: "/bin/true", restart: "never" },
  spawnDaemon: async () => null,
  startupTimeoutMs: 1,
  pollIntervalMs: 1,
  isPidRunning: () => false
}).catch(() => undefined);

console.log("spec=" + (await readFile("$outside/spec.json", "utf8")).includes("/bin/true"));
console.log("state=" + String(await stat("$outside/state.json").then(() => true, () => false)));
console.log("meta=" + String(await stat("$outside/meta.json").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '84,111p;555,624p'
```

## Observed Behavior

The normal id `api` writes launcher state through `launch/api -> outside`:

```text
spec=true
state=true
meta=true
```

No `../` or path separator is supplied in the id. `resolveProcessDir()` textually joins `baseDir` and `id`, while subsequent directory creation and JSON writes follow the pre-existing symlink target.

## Expected Behavior

Starting a managed process should persist all process state beneath the canonical configured launch directory. A process entry that resolves outside `baseDir` should be rejected before any state files are written.

## Impact

A crafted symlink in launch state can redirect normal `launch start` storage writes to arbitrary external locations accessible to the process, overwriting files named `spec.json`, `state.json`, or `meta.json` outside the intended launch-state boundary.
