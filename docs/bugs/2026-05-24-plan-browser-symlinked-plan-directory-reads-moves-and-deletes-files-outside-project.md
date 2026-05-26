# Plan browser follows a symlinked plan directory and reads, moves, or deletes files outside the project

## Summary

The plan browser resolves its configured plan directory textually under the working project and performs discovery and destructive actions there without checking canonical containment. If the standard `docs/plans` directory is a symbolic link to an external location, discovery reads external plan content, archive moves an external file into an external archive directory, and delete removes an external file.

## Reproduction

From the repository root, create a disposable project whose default plan directory points at an external fixture directory, then call the exported browser discovery and action functions:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/docs" "$probe/home" "$probe/outside"
ln -s "$probe/outside" "$probe/project/docs/plans"
printf '# External Archive Plan\n' > "$probe/outside/archive-me.md"
printf '# External Delete Plan\n' > "$probe/outside/delete-me.md"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile, stat } from "node:fs/promises";
import { discoverAllPlans } from "file://$PWD/packages/plan-browser/src/discovery.ts";
import { archivePlan, deletePlan } from "file://$PWD/packages/plan-browser/src/actions.ts";
import { resolveConfigPath, resolveProjectConfigPath } from "file://$PWD/packages/poe-code-config/src/store.ts";

const cwd = "$probe/project";
const homeDir = "$probe/home";
const entries = await discoverAllPlans({
  cwd,
  homeDir,
  configPath: resolveConfigPath(homeDir),
  projectConfigPath: resolveProjectConfigPath(cwd)
});
console.log("discovered=" + JSON.stringify(entries.map(({ path, absolutePath, title }) => ({ path, absolutePath, title }))));
const archiveEntry = entries.find((entry) => entry.path.endsWith("archive-me.md"))!;
const deleteEntry = entries.find((entry) => entry.path.endsWith("delete-me.md"))!;
console.log("archivedPath=" + await archivePlan(archiveEntry, fs as any));
await deletePlan(deleteEntry, fs as any);
console.log("archived=" + await readFile("$probe/outside/archive/archive-me.md", "utf8"));
try { await stat("$probe/outside/delete-me.md"); console.log("deleted=false"); }
catch { console.log("deleted=true"); }
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/plan-browser/src/discovery.ts | sed -n '24,55p;115,192p'
nl -ba packages/plan-browser/src/actions.ts | sed -n '24,58p'
```

## Observed Behavior

Discovery presents external files as ordinary `docs/plans` entries, and destructive actions alter files in the external target directory:

```text
discovered=[{"path":"docs/plans/delete-me.md","absolutePath":"<probe>/project/docs/plans/delete-me.md","title":"External Delete Plan"},{"path":"docs/plans/archive-me.md","absolutePath":"<probe>/project/docs/plans/archive-me.md","title":"External Archive Plan"}]
archivedPath=<probe>/project/docs/plans/archive/archive-me.md
archived=# External Archive Plan
deleted=true
```

The apparent archive path resolves through `project/docs/plans -> outside`, so the archived file is actually written to `<probe>/outside/archive/archive-me.md` and `delete-me.md` is removed from `<probe>/outside`.

## Expected Behavior

Project plan discovery and lifecycle actions should only operate on files canonically contained within the selected plan directory inside the project, or explicitly reject a configured/default plan directory that escapes through a symlink. Archive and delete actions must not mutate external files presented through project-local links.

## Impact

A compromised project containing a symlinked plan directory can cause the plan browser to disclose external Markdown content as local plans and to move or delete arbitrary user-writable files when normal archive/delete actions are performed. This violates the project plan storage boundary independently of task-list storage behavior.
