---
name: "Workspace download follows symlinked local subdirectories outside the project"
---

# Workspace download follows symlinked local subdirectories outside the project

## Summary

`downloadWorkspace()` maps remote relative paths into `env.cwd` with `path.join()` and then writes or deletes them without checking canonical containment. If a local project subdirectory is replaced with a symlink to an external directory after upload state is captured, downloaded additions are written outside the project and remotely deleted files cause deletion of external local files.

## Reproduction

From the repository root, create a disposable local and remote workspace, upload the initial tracked file, replace its local parent directory with a symlink, then download a remote change set:

```sh
repo=$PWD
probe=$(mktemp -d)
local="$probe/local"
remote="$probe/remote"
outside="$probe/outside-local"
upload="$probe/upload"
mkdir -p "$local/linked" "$remote" "$outside" "$upload"
printf 'initial-local\n' > "$local/linked/old.txt"

cat > "$probe/repro.mts" <<EOF
import { readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { uploadWorkspace, downloadWorkspace } from "file://$PWD/packages/agent-harness-tools/src/workspace-transfer.ts";

const env = { cwd: "$local", workspaceDir: "$remote", uploadDir: "$upload" };
await uploadWorkspace(env, {});

await rm("$local/linked", { recursive: true });
await symlink("$outside", "$local/linked");
await writeFile("$outside/old.txt", "outside-delete-me\n");
await rm("$remote/linked/old.txt");
await writeFile("$remote/linked/new.txt", "remote-write\n");

console.log("result=" + JSON.stringify(await downloadWorkspace(env, { conflictPolicy: "overwrite" })));
console.log("written=" + await readFile("$outside/new.txt", "utf8"));
console.log("deleted=" + String(await stat("$outside/old.txt").then(() => false, () => true)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-harness-tools/src/workspace-transfer.ts | sed -n '141,200p;217,246p;383,429p'
```

## Observed Behavior

The download reports successful synchronization while following `local/linked -> outside-local` for both a new remote file and a tracked file deletion:

```text
result={"files":1,"bytes":13,"conflicts":[]}
written=remote-write
deleted=true
```

All remote relative paths are ordinary workspace paths (`linked/new.txt` and `linked/old.txt`). The escape occurs because `downloadWorkspace()` computes textual local paths under `env.cwd` and performs filesystem mutations through an existing symlinked parent directory.

## Expected Behavior

Workspace downloads should modify only files that resolve beneath the canonical local project directory. Paths whose local parent chain escapes through symlinks should be rejected before any write or deletion occurs.

## Impact

A crafted or replaced symlink inside a local project can redirect synchronized sandbox output to arbitrary writable external locations and cause deletion of external local files when the remote workspace removes tracked files. This violates the local workspace isolation boundary during normal sync operations.
