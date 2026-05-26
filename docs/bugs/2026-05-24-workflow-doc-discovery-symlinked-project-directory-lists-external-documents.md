# Workflow document discovery follows a symlinked project directory and lists external documents

## Summary

Shared workflow-document discovery reads project documents from `<project>/.poe-code/<subDirectory>`, but does not reject a symbolic link at that directory path. If `<project>/.poe-code/ralph/plans` points outside the project, `discoverWorkflowDocs()` discovers external Markdown documents and reports them through textual project-local paths.

## Reproduction

From the repository root, expose an external workflow-document directory through the expected project Ralph path and invoke the exported discovery API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/ralph" "$probe/home/.poe-code" "$probe/outside-docs"
printf '# External Ralph workflow document\n' > "$probe/outside-docs/external.md"
ln -s "$probe/outside-docs" "$probe/project/.poe-code/ralph/plans"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { discoverWorkflowDocs } from "file://$PWD/packages/agent-harness-tools/src/paths.ts";

console.log(
  JSON.stringify(
    await discoverWorkflowDocs({
      cwd: "$probe/project",
      homeDir: "$probe/home",
      subDirectory: "ralph/plans",
      fs: fs as any
    })
  )
);
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/.poe-code/ralph/plans"

nl -ba packages/agent-harness-tools/src/paths.ts | sed -n '3,12p;65,109p'
```

## Observed Behavior

The discovery API traverses the external target and returns its document as if it were stored under the project workflow directory:

```text
<probe>/project/.poe-code/ralph/plans -> <probe>/outside-docs
["<probe>/project/.poe-code/ralph/plans/external.md"]
```

`discoverWorkflowDocs()` constructs the project directory path, `discoverFromDirectory()` calls `readdir()` through its symlink target, and the returned document path preserves the unvalidated project-facing symlink path.

## Expected Behavior

Project workflow discovery should list only canonical documents contained inside the selected project's `.poe-code` workflow directories. Symlinked project directories escaping the project should be rejected or excluded from discovery.

## Impact

A project can expose external Markdown documents as local workflow documents. Downstream interactive selection or execution can therefore present and operate on workflow content not actually stored within the project, obscuring its source and bypassing project containment expectations.
