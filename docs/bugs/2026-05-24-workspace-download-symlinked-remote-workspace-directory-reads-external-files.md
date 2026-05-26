# Workspace download follows a symlinked remote workspace directory and reads external files

## Summary

`downloadWorkspace()` recursively enumerates and reads `env.workspaceDir` without rejecting a symbolic link at that root. A remote workspace entry can therefore point outside its designated location and cause external files to be downloaded into the local project.

## Reproduction

From the repository root, create a remote workspace symlink targeting an external directory containing one file, then download into an empty local workspace:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/local" "$probe/remote" "$probe/outside-workspace" "$probe/upload"
printf 'external remote content\n' > "$probe/outside-workspace/external.txt"
ln -s "$probe/outside-workspace" "$probe/remote/workspace"

cat > "$probe/repro.mts" <<EOF
import { downloadWorkspace } from "file://$PWD/packages/agent-harness-tools/src/workspace-transfer.ts";

console.log(JSON.stringify(await downloadWorkspace({
  cwd: "$probe/local",
  workspaceDir: "$probe/remote/workspace",
  uploadDir: "$probe/upload"
}, { conflictPolicy: "overwrite" })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/remote/workspace"
cat "$probe/local/external.txt"

nl -ba packages/agent-harness-tools/src/workspace-transfer.ts | sed -n '141,199p;203,246p'
```

## Observed Behavior

Download succeeds and copies the external symlink target's file into the local workspace:

```text
{"files":1,"bytes":24,"conflicts":[]}
<probe>/remote/workspace -> <probe>/outside-workspace
<probe>/local/external.txt contains: external remote content
```

## Expected Behavior

Downloads should enumerate files only from canonical remote workspace directories contained in the configured execution environment. A symlinked remote workspace root escaping that location should be rejected before reading files.

## Impact

A workspace sync can disclose arbitrary external remote files and import them into the local project while presenting them as ordinary workspace changes. This is distinct from local-download symlink writes because the escape occurs at the remote read boundary.
