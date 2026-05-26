# Workflow document discovery follows a symlinked global directory and lists external documents

## Summary

Shared workflow-document discovery reads global documents from `<home>/.poe-code/<subDirectory>`, but does not reject a symbolic link at that directory path. If `<home>/.poe-code/ralph/plans` points outside the user state root, `discoverWorkflowDocs()` discovers external Markdown documents and reports them through textual global-state paths.

## Reproduction

From the repository root, expose an external workflow-document directory through the expected global Ralph path and invoke the exported discovery API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home/.poe-code/ralph" "$probe/outside-docs"
printf '# External global Ralph workflow document\n' > "$probe/outside-docs/global.md"
ln -s "$probe/outside-docs" "$probe/home/.poe-code/ralph/plans"

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
ls -ld "$probe/home/.poe-code/ralph/plans"

nl -ba packages/agent-harness-tools/src/paths.ts | sed -n '3,12p;65,109p'
```

## Observed Behavior

The discovery API traverses the external target and returns its document as if it were stored under the global workflow directory:

```text
<probe>/home/.poe-code/ralph/plans -> <probe>/outside-docs
["<probe>/home/.poe-code/ralph/plans/global.md"]
```

`discoverWorkflowDocs()` constructs the global directory path, `discoverFromDirectory()` calls `readdir()` through its symlink target, and the returned document path preserves the unvalidated global-facing symlink path.

## Expected Behavior

Global workflow discovery should list only canonical documents contained inside the selected user's `.poe-code` workflow directories. Symlinked global directories escaping the state root should be rejected or excluded from discovery.

## Impact

External documents can be presented as trusted user-level workflow documents. Downstream interactive selection or execution can therefore use workflow content not actually stored within the user's state root while concealing its external source.
