# Pipeline status writer follows a symlinked plan file and rewrites an external document

## Summary

The exported pipeline `writeTaskStatus()` function reads and writes the supplied plan path directly, without verifying that a project plan file is not a symbolic link to external content. A symlinked `docs/plans/*.md` entry can therefore cause normal task-status persistence to rewrite an external Markdown plan and canonicalize its frontmatter outside the project.

## Reproduction

From the repository root, create a disposable project containing a plan symlink to an external pipeline document, then persist a task status through the exported writer:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/docs/plans" "$probe/outside"
cat > "$probe/outside/external-plan.md" <<'EOF'
---
kind: pipeline
tasks:
  - id: first
    title: First
    prompt: Do first
    status: open
---
# External plan
EOF
ln -s "$probe/outside/external-plan.md" "$probe/project/docs/plans/linked.md"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { writeTaskStatus } from "file://$PWD/packages/pipeline/src/plan/writer.ts";

await writeTaskStatus({
  fs: fs as any,
  planPath: "$probe/project/docs/plans/linked.md",
  taskId: "first",
  status: "done"
});
console.log(await readFile("$probe/outside/external-plan.md", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/docs/plans/linked.md"

nl -ba packages/pipeline/src/plan/writer.ts | sed -n '70,92p;195,230p'
```

## Observed Behavior

The external target is rewritten through the in-project symlink: its task status changes to `done` and the writer also adds canonical pipeline schema/version fields:

```text
<probe>/project/docs/plans/linked.md -> <probe>/outside/external-plan.md
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: first
    title: First
    prompt: Do first
    status: done
---
# External plan
```

`writeTaskStatus()` loads the document via `readPlanFile()` at `options.planPath`, mutates its YAML representation, then writes the serialized document back to that same path. Both filesystem operations follow the project-local symlink to the external file.

## Expected Behavior

Pipeline status persistence for a project plan should modify only a canonical plan document contained within the project plan directory. The writer should reject symbolic-link file escapes or otherwise prevent state updates from overwriting external documents.

## Impact

A crafted project can expose an external Markdown file as a pipeline plan and cause routine status updates during pipeline execution to overwrite that external document. Besides changing status data, canonicalization may introduce additional frontmatter modifications, increasing the destructive effect outside the project boundary.
