# Task list YAML-file backend follows a symlinked store and reads external tasks as local state

## Summary

The task-list `yaml-file` backend reads the configured store path directly and does not reject a symbolic link at that file. If a project-local task store points outside the project, `openTaskList()` exposes external tasks as local list state and reports their `sourcePath` using the project-facing symlink path.

## Reproduction

From the repository root, expose an external YAML store through a local-looking task-list file and read it through the public package API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/outside"
cat > "$probe/outside/tasks.yaml" <<'EOF'
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json
kind: task-store
version: 1
lists:
  plans:
    existing:
      name: External existing
      state: draft
      description: outside
EOF
ln -s "$probe/outside/tasks.yaml" "$probe/project/tasks.yaml"

cat > "$probe/repro.mts" <<EOF
import { openTaskList } from "file://$PWD/packages/task-list/src/index.ts";

const store = await openTaskList({ type: "yaml-file", path: "$probe/project/tasks.yaml", create: false });
console.log(JSON.stringify(await store.list("plans").all({ includeArchived: true })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/project/tasks.yaml"

nl -ba packages/task-list/src/open.ts | sed -n '33,66p'
nl -ba packages/task-list/src/backends/yaml-file.ts | sed -n '113,123p;344,367p;488,530p;728,746p'
```

## Observed Behavior

The YAML backend follows the local store symlink and returns the external task while identifying the source as the local symlink path:

```text
<probe>/project/tasks.yaml -> <probe>/outside/tasks.yaml
[{"list":"plans","id":"existing","qualifiedId":"plans/existing","name":"External existing","state":"draft","description":"outside","metadata":{},"sourcePath":"<probe>/project/tasks.yaml"}]
```

`readStore()` reads `deps.path` directly, and `createTask()` stores `path.resolve(sourcePath)` without resolving symlinks or verifying containment beneath an expected task-list root.

## Expected Behavior

A project-local YAML task store should be loaded only from a canonical file inside the selected project or explicitly configured trusted storage root. A symlink escaping that boundary should be rejected rather than surfaced as local tasks.

## Impact

External task content can be presented as in-project workflow state to task-list consumers. Commands or automation selecting work from this backend may act on unreviewed external tasks while all reported source paths appear local to the project.
