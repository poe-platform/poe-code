# Markdown task-list archive directories follow symlinks outside the configured list

## Summary

The `markdown-dir` backend uses an `archive/` child directory for archived tasks, but never verifies where that directory resolves. If a list's `archive` directory is a symlink to an external directory, archiving a task writes it outside the configured store, and later `get()` and `delete()` operations read and delete the external file.

## Reproduction

From the repository root, create a disposable task list with a symlinked archive directory and archive a newly created task:

```sh
repo=$PWD
probe=$(mktemp -d)
store="$probe/store"
outside="$probe/outside-archive"
mkdir -p "$store/plans" "$outside"
ln -s "$outside" "$store/plans/archive"

cat > "$probe/repro.mts" <<EOF
import { readFile, lstat } from "node:fs/promises";
import { openTaskList } from "file://$PWD/packages/task-list/src/index.ts";

const taskList = await openTaskList({
  type: "markdown-dir",
  path: "$store",
  create: true,
  frontmatterMode: "passthrough"
});
const plans = taskList.list("plans");

await plans.create({ id: "archive-me", name: "Archive Me", description: "archive-secret" });
await plans.fire("archive-me", "archive");
console.log("written=" + (await readFile("$outside/archive-me.md", "utf8")).includes("archive-secret"));
console.log("read=" + JSON.stringify(await plans.get("archive-me")));
await plans.delete("archive-me");
console.log("deleted=" + String(await lstat("$outside/archive-me.md").then(() => false, () => true)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/task-list/src/backends/markdown-dir.ts | sed -n '112,124p;396,420p;632,660p;930,1038p'
```

## Observed Behavior

The archive transition and subsequent operations follow `store/plans/archive -> outside-archive`:

```text
written=true
read={"list":"plans","id":"archive-me",...,"state":"archived","description":"archive-secret",...}
deleted=true
```

The task identifier and list name are ordinary validated values; only the pre-existing archive directory symlink causes the boundary escape.

## Expected Behavior

Archived task storage should remain beneath the canonical configured list root. Archive operations should reject an `archive` path that resolves outside that storage boundary instead of writing, reading, or deleting external files.

## Impact

An attacker or compromised workspace that introduces an archive symlink can redirect normal archive lifecycle actions to external markdown files. Applications using task lists for plans or work items can overwrite or remove user-accessible data outside the task store.
