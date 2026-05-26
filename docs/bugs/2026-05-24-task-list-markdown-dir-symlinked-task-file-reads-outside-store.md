# Markdown task-list task file reads follow symlinks outside the configured store

## Summary

The `markdown-dir` backend treats a symlinked markdown entry as a regular task file because it checks it with `stat()` and then calls `readFile()` on that path. A task file symlink within an otherwise legitimate list can therefore cause `get()` and listing operations to disclose an arbitrary external markdown file.

## Reproduction

From the repository root, create a disposable task list with a single symlinked markdown entry pointing outside the store:

```sh
repo=$PWD
probe=$(mktemp -d)
store="$probe/store"
mkdir -p "$store/plans"

cat > "$probe/outside-file.md" <<'EOF'
---
name: External File
state: draft
---

file-secret
EOF
ln -s "$probe/outside-file.md" "$store/plans/01-symlinked.md"

cat > "$probe/repro.mts" <<EOF
import { openTaskList } from "file://$PWD/packages/task-list/src/index.ts";

const taskList = await openTaskList({
  type: "markdown-dir",
  path: "$store",
  frontmatterMode: "passthrough"
});
const plans = taskList.list("plans");

console.log("get=" + JSON.stringify(await plans.get("symlinked")));
console.log("all=" + JSON.stringify(await plans.all()));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/task-list/src/backends/markdown-dir.ts | sed -n '337,378p;380,420p;582,629p;818,845p'
```

## Observed Behavior

Both reads parse and return the contents of the external symlink target as a task within `plans`:

```text
get={"list":"plans","id":"symlinked",...,"name":"External File",...,"description":"file-secret\n",...}
all=[{"list":"plans","id":"symlinked",...,"description":"file-secret\n",...}]
```

The task filename itself has a valid in-store shape; the disclosure occurs because `stat()` follows the file symlink and `readFile()` reads the resolved external target.

## Expected Behavior

Task discovery and retrieval should not follow symlinked task files outside the canonical task-store directory. Such entries should be rejected or ignored before their content is read.

## Impact

A repository containing a crafted markdown task symlink can expose arbitrary readable markdown files to task-list clients and higher-level plan/task commands, even when all requested identifiers pass normal validation.
