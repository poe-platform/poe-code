# Launch rm follows a symlinked child directory and deletes external files before erroring

## Summary

`removeManagedProcess()` recursively removes every child below a managed-process directory, but its directory traversal follows symbolic links contained inside an otherwise local process entry. A symlinked child directory causes deletion of external target files before cleanup fails while attempting to remove the symlink as a directory.

## Reproduction

From the repository root, create a stopped local managed process containing an unrelated child-directory link to an external file, then remove it through the public launcher API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/launch/job" "$probe/outside/nested"
cat > "$probe/launch/job/spec.json" <<'EOF'
{"id":"job","command":"/bin/true","args":[],"restart":"never"}
EOF
cat > "$probe/launch/job/state.json" <<'EOF'
{"id":"job","command":"/bin/true","args":[],"status":"stopped","pid":null,"restartCount":0,"lastExitCode":0}
EOF
printf 'keep-me\n' > "$probe/outside/nested/victim.txt"
ln -s "$probe/outside/nested" "$probe/launch/job/artifacts"

cat > "$probe/repro.mts" <<EOF
import { stat } from "node:fs/promises";
import { removeManagedProcess } from "file://$PWD/packages/process-launcher/src/index.ts";

try {
  await removeManagedProcess({ baseDir: "$probe/launch", id: "job" });
} catch (error) {
  console.log("error=" + (error as Error).message);
}
console.log("victim=" + String(await stat("$probe/outside/nested/victim.txt").then(() => true, () => false)));
console.log("artifacts=" + String(await stat("$probe/launch/job/artifacts").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/launch/job/artifacts"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '284,303p'
nl -ba packages/process-launcher/src/state/state-store.ts | sed -n '8,43p;109,115p'
```

## Observed Behavior

Removal traverses `job/artifacts -> outside/nested`, deletes the external victim file, and only then errors because the final directory-removal operation is applied to the symlink itself:

```text
<probe>/launch/job/artifacts -> <probe>/outside/nested
error=ENOTDIR: not a directory, rmdir '<probe>/launch/job/artifacts'
victim=false
artifacts=true
```

`removeDirectory()` uses `stat()` on each child, which follows the symlink and treats it as a directory. It recurses through the external target and calls `rm()` for target files before it encounters the final failure.

## Expected Behavior

Managed-process removal should delete only canonical entries within the selected process directory. Symlinked child directories should be removed as links or rejected without traversing and deleting external targets.

## Impact

A single symlink inside otherwise legitimate stopped launch state can make normal `launch rm` cleanup delete arbitrary external files reachable by the user. This destructive bypass is independent of both id traversal and whole-process-directory symlinks.
