# Worktree registry follows a symlinked state file and reads and overwrites an external document

## Summary

The `@poe-code/worktree` registry API reads and writes the supplied YAML registry file without rejecting symbolic links. A project-local registry entry symlink redirects worktree metadata persistence to an external document.

## Reproduction

1. From the repository root, run this disposable project-state probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-worktree-registry-probe.XXXXXX)
   mkdir -p "$probe/project/.poe-code"
   printf 'worktrees: []\n' > "$probe/outside.yml"
   ln -s "$probe/outside.yml" "$probe/project/.poe-code/worktrees.yaml"
   cat > "$probe/repro.mts" <<EOF
   import { addWorktreeEntry, readRegistry } from "${workspace}/packages/worktree/src/registry.ts";
   import * as fs from "node:fs/promises";
   const file = "${probe}/project/.poe-code/worktrees.yaml";
   await addWorktreeEntry(file, {
     name: "probe", path: "/tmp/probe", branch: "poe-code/probe", baseBranch: "main",
     createdAt: "2026-05-24", source: "local", agent: "codex", status: "active"
   }, fs as any);
   console.log(JSON.stringify(await readRegistry(file, fs as any)));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/.poe-code/worktrees.yaml"
   cat "$probe/outside.yml"
   ```

## Observed Behavior

The API reports and reads the added worktree entry through the apparent project registry path, while the external YAML target is overwritten with persisted worktree metadata.

`packages/worktree/src/registry.ts:10` through `packages/worktree/src/registry.ts:20` read registry contents directly from the supplied path, and `packages/worktree/src/registry.ts:23` through `packages/worktree/src/registry.ts:67` write updated registry state through that same unchecked destination.

## Expected Behavior

When used for project worktree state, registry reads and updates should operate only on canonical state files inside the project or configured state root. A symlinked registry file escaping that boundary should be rejected.

## Impact

A crafted project-state entry can inject external worktree metadata into normal operations and make creation, removal, or status updates overwrite an unrelated external YAML document.
