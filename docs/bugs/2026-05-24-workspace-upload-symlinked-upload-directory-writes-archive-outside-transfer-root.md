---
name: "Workspace upload follows a symlinked upload directory and writes its archive outside the transfer root"
---

# Workspace upload follows a symlinked upload directory and writes its archive outside the transfer root

## Summary

`uploadWorkspace()` writes `workspace.tar` to `path.join(env.uploadDir, "workspace.tar")` without rejecting a symbolic link at `uploadDir`. A configured transfer location can therefore redirect the generated workspace archive into an external directory.

## Reproduction

From the repository root, create a small local workspace and a remote upload directory symlink targeting an external location, then call the transfer API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/local" "$probe/remote" "$probe/outside-upload"
printf 'local file\n' > "$probe/local/a.txt"
ln -s "$probe/outside-upload" "$probe/remote/upload"

cat > "$probe/repro.mts" <<EOF
import { uploadWorkspace } from "file://$PWD/packages/agent-harness-tools/src/workspace-transfer.ts";

console.log(JSON.stringify(await uploadWorkspace({
  cwd: "$probe/local",
  workspaceDir: "$probe/remote/workspace",
  uploadDir: "$probe/remote/upload"
}, {})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/remote/upload"
find "$probe/outside-upload" -maxdepth 1 -type f -print

nl -ba packages/agent-harness-tools/src/workspace-transfer.ts | sed -n '63,134p'
```

## Observed Behavior

The upload reports success while the generated archive is created under the external symlink target:

```text
{"files":1,"bytes":11,"skipped":[]}
<probe>/remote/upload -> <probe>/outside-upload
<probe>/outside-upload/workspace.tar
```

## Expected Behavior

Upload archives should be written only to canonical transfer directories authorized for the execution environment. A symlinked `uploadDir` escaping that transfer root should be rejected before archive creation.

## Impact

Uploading a workspace can write an archive containing project files into an external location, leaking transferred source content and mutating filesystem state outside the designated upload directory.
