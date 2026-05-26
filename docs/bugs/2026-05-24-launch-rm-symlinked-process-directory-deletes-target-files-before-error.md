# Launch rm follows a symlinked process directory and deletes external target files before erroring

## Summary

`removeManagedProcess()` recursively removes the computed process directory without preventing symlink traversal. If `<baseDir>/<id>` is a symlink to an external directory, removal traverses the symlink, deletes files in its target, and only then fails when attempting to remove the symlink path as a directory.

## Reproduction

From the repository root, create a disposable stopped process record behind a normal symlinked id, with a victim file in a child directory:

```sh
repo=$PWD
probe=$(mktemp -d)
base="$probe/launch"
outside="$probe/outside"
mkdir -p "$base" "$outside/nested"
ln -s "$outside" "$base/job"
printf '{"id":"job","command":"/bin/true","restart":"never"}\n' > "$outside/spec.json"
printf 'victim' > "$outside/nested/marker.txt"

cat > "$probe/repro.mts" <<EOF
import { stat } from "node:fs/promises";
import { removeManagedProcess } from "file://$PWD/packages/process-launcher/src/index.ts";

try {
  await removeManagedProcess({ baseDir: "$base", id: "job", isPidRunning: () => false });
} catch (error) {
  console.log("error=" + (error instanceof Error ? (error as NodeJS.ErrnoException).code : "unknown"));
}
console.log("spec=" + String(await stat("$outside/spec.json").then(() => true, () => false)));
console.log("marker=" + String(await stat("$outside/nested/marker.txt").then(() => true, () => false)));
console.log("link=" + String(await stat("$base/job").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '284,303p;617,624p'
nl -ba packages/process-launcher/src/state/state-store.ts | sed -n '9,42p;112,115p'
```

## Observed Behavior

The remover deletes files in the external symlink target, then rejects while the symlink itself still exists:

```text
error=ENOTDIR
spec=false
marker=false
link=true
```

This occurs with the valid-looking process id `job`; no path traversal segments are necessary.

## Expected Behavior

Removing managed process state should never recursively traverse a process-directory symlink outside the canonical launch root. A symlinked entry should be safely rejected or removed without touching its target contents.

## Impact

A crafted symlink under launch state can cause normal cleanup to destroy arbitrary external files and subdirectories accessible to the process. The subsequent error does not prevent the destructive side effect and may conceal that target data has already been removed.
