# Markdown task-list list directories follow symlinks outside the configured store

## Summary

The `markdown-dir` task-list backend constructs list locations beneath its configured `path`, but does not verify canonical containment before reading or mutating them. If a list directory is a symlink to an external directory, ordinary `get()`, `create()`, and `delete()` operations read, create, and remove markdown files outside the task-list store.

## Reproduction

From the repository root, create a disposable task store with a symlinked list directory and invoke the public SDK:

```sh
repo=$PWD
probe=$(mktemp -d)
store="$probe/store"
outside="$probe/outside-list"
mkdir -p "$store" "$outside"
ln -s "$outside" "$store/linked"

cat > "$outside/01-outside.md" <<'EOF'
---
name: Outside
state: draft
---

list-secret
EOF

cat > "$probe/repro.mts" <<EOF
import { readFile, lstat } from "node:fs/promises";
import { openTaskList } from "file://$PWD/packages/task-list/src/index.ts";

const taskList = await openTaskList({
  type: "markdown-dir",
  path: "$store",
  create: true,
  frontmatterMode: "passthrough"
});
const linked = taskList.list("linked");

console.log("read=" + JSON.stringify(await linked.get("outside")));
await linked.create({ id: "created", name: "Created", description: "created-outside" });
console.log("created=" + (await readFile("$outside/02-created.md", "utf8")).includes("created-outside"));
await linked.delete("outside");
console.log("deleted=" + String(await lstat("$outside/01-outside.md").then(() => false, () => true)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/task-list/src/backends/markdown-dir.ts | sed -n '108,115p;380,420p;577,629p;847,900p;1030,1050p'
```

## Observed Behavior

The SDK follows `store/linked -> outside-list` for both reads and mutations:

```text
read={"list":"linked","id":"outside",...,"description":"list-secret\n",...}
created=true
deleted=true
```

The input list name contains no traversal components. The backend validates the text `linked`, then uses `path.join(rootPath, list)` and normal filesystem calls that transparently follow the symlink.

## Expected Behavior

The markdown task-list backend should keep reads and writes within the canonical configured store. A list directory whose resolved location escapes that store should be rejected rather than operated on.

## Impact

A crafted task-store list symlink can make consumers disclose, overwrite, create, or delete markdown files outside their task storage directory using normal task operations. This affects any SDK or CLI surface backed by `markdown-dir` lists.
