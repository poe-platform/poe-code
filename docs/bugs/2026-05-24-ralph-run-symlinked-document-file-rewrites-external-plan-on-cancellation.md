# Ralph run follows a symlinked document file and rewrites an external plan on cancellation

## Summary

The exported `runRalph()` workflow resolves a project document path textually and updates its status frontmatter through ordinary reads and writes. If a project-local Ralph document is a symbolic link to an external Markdown file, even an already-aborted run rewrites the external document while returning a cancellation result and without invoking an agent.

## Reproduction

From the repository root, create a project-local symlink to an external Ralph document and run it with an already-aborted signal:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/docs/plans" "$probe/home" "$probe/outside"
cat > "$probe/outside/external-ralph.md" <<'EOF'
---
kind: ralph
status:
  state: in_progress
  iteration: 4
iterations: 1
---
# External Ralph

Do nothing.
EOF
ln -s "$probe/outside/external-ralph.md" "$probe/project/docs/plans/linked.md"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { runRalph } from "file://$PWD/packages/ralph/src/run/ralph.ts";

const controller = new AbortController();
controller.abort();
const result = await runRalph({
  cwd: "$probe/project",
  homeDir: "$probe/home",
  docPath: "docs/plans/linked.md",
  fs: fs as any,
  runAgent: async () => { throw new Error("agent should not run"); },
  signal: controller.signal
});
console.log("result=" + JSON.stringify(result));
console.log("external=" + await readFile("$probe/outside/external-ralph.md", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/docs/plans/linked.md"

nl -ba packages/ralph/src/run/ralph.ts | sed -n '34,66p;459,481p'
```

## Observed Behavior

An aborted Ralph invocation reports cancellation without calling the provided agent, but it rewrites the external symlink target, resetting its state and adding canonical schema/version fields:

```text
result={"stopReason":"cancelled","docPath":"docs/plans/linked.md","iterationsCompleted":0,...}
<probe>/project/docs/plans/linked.md -> <probe>/outside/external-ralph.md
external=---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/ralph.schema.json
kind: ralph
version: 1
iterations: 1
status:
  state: open
  iteration: 0
---
# External Ralph

Do nothing.
```

`runRalph()` resolves the document under the project and, when `options.signal.aborted` is true, immediately invokes `updateFrontmatter()`. That helper reads and writes `absoluteDocPath` directly, so an existing project-local symlink redirects the mutation externally.

## Expected Behavior

Ralph workflow status updates should modify only canonical documents contained within the selected workflow/project storage boundary. A symlinked plan file escaping that boundary should be rejected before cancellation or progress handling writes status metadata.

## Impact

A crafted project can cause even a cancelled Ralph invocation to overwrite an arbitrary external writable Markdown document presented through a local symlink. The mutation is not limited to a status value: it may normalize and replace frontmatter content outside the project without any agent execution.
