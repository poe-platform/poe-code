# Agent Maestro accepts a symlinked workspace directory and redirects driver writes outside its root

## Summary

`ensureWorkspace()` validates a workspace path only with textual `path.resolve()` containment and uses `stat()`/`mkdir()` on the resulting path. If the computed task workspace already exists as a symlink to an external directory, it is accepted as a valid directory and returned to workflow drivers. The built-in Ralph driver then writes its copied plan into the external symlink target.

## Reproduction

From the repository root, create a disposable Maestro workspace root with a symlinked task workspace and run the built-in Ralph driver with a harmless stub runner:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/root"
outside="$probe/outside"
mkdir -p "$root" "$outside"
ln -s "$outside" "$root/job"
printf 'plan-body\n' > "$probe/plan.md"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { ensureWorkspace } from "file://$PWD/packages/agent-maestro/src/workspace/manager.ts";
import { createRalphDriver } from "file://$PWD/packages/agent-maestro/src/drivers/ralph.ts";

const workspace = await ensureWorkspace("$root", "job");
const driver = createRalphDriver({
  runRalph: async () => ({ stopReason: "done", iterations: 0, success: true }) as any
});
const outcome = await driver.run({
  task: {
    list: "plans",
    id: "job",
    qualifiedId: "plans/job",
    name: "Job",
    state: "draft",
    description: "",
    metadata: {},
    sourcePath: "$probe/plan.md"
  },
  attempt: 1,
  workspaceDir: workspace.path,
  planPath: "$probe/plan.md",
  cfg: {} as any,
  abort: new AbortController().signal,
  emit: () => undefined,
  spawn: async () => ({ stdout: "", stderr: "", exitCode: 0 }) as any,
  logger: { warn: () => undefined }
});

console.log("workspace=" + workspace.path);
console.log("outcome=" + JSON.stringify(outcome));
console.log("copied=" + await readFile("$outside/plan.md", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-maestro/src/workspace/manager.ts | sed -n '11,31p;57,91p;109,127p'
nl -ba packages/agent-maestro/src/runtime/loop.ts | sed -n '235,291p'
nl -ba packages/agent-maestro/src/drivers/ralph.ts | sed -n '39,62p'
```

## Observed Behavior

The workspace manager returns the symlinked path as an existing workspace, and the Ralph driver copies the plan into its external target:

```text
workspace=.../root/job
outcome={"reason":"normal"}
copied=plan-body
```

The identifier `job` contains no traversal syntax. `ensureWorkspace()` accepts `root/job -> outside` because `fs.stat()` reports the symlink target as a directory, and the returned path is subsequently used as the driver's working and output directory.

## Expected Behavior

Maestro workspaces should resolve beneath the canonical configured workspace root. An existing task workspace symlink that escapes that root should be rejected before a workflow driver performs any file operation there.

## Impact

A crafted workspace symlink can redirect built-in workflow-driver writes and agent working-directory activity outside the configured Maestro workspace root. This permits unintended file creation or modification in external writable directories during routine task execution.
