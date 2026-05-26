# Memory edit symlinked temp directory copies page outside memory root

## Summary

`editPage()` stages the selected memory page under `<memory-root>/.tmp/` before launching an editor, but it does not reject a symlink at `.tmp`. A crafted memory directory can redirect this temporary copy outside the memory root, causing normal edit operations to write page contents into an external directory even when no edits are saved.

## Reproduction

From the repository root, run a disposable script that makes `.tmp` a symlink to an external directory and invokes `editPage()` without changing the editor copy:

```sh
cat > /tmp/memory-edit-symlinked-temp-root-probe.mjs <<'EOF'
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { editPage } from '/Users/kjopek/Workspace/poe-code/packages/memory/src/edit.ts';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-edit-tmp-'));
const root = path.join(temp, 'memory');
const outside = path.join(temp, 'outside');
await fs.mkdir(path.join(root, 'pages'), { recursive: true });
await fs.mkdir(outside, { recursive: true });
await fs.writeFile(path.join(root, 'pages', 'note.md'), '# Secret page\n', 'utf8');
await fs.symlink(outside, path.join(root, '.tmp'));
const canonicalOutside = await fs.realpath(outside);
let canonicalEditorPath = '';
let copiedPage = '';
const result = await editPage(root, 'pages/note.md', {
  reason: 'read',
  launchEditor: async (filePath) => {
    canonicalEditorPath = await fs.realpath(filePath);
    copiedPage = await fs.readFile(canonicalEditorPath, 'utf8');
  }
});
console.log(JSON.stringify({ result, copiedPage, canonicalEditorPath, escaped: canonicalEditorPath.startsWith(canonicalOutside + path.sep) }));
EOF
./node_modules/.bin/tsx /tmp/memory-edit-symlinked-temp-root-probe.mjs
nl -ba packages/memory/src/edit.ts | sed -n '17,50p'
```

## Observed Behavior

The editor staging file resolves beneath the external directory and contains the memory page contents, even though the editor makes no changes and `editPage()` reports `changed: false`:

```text
{"result":{"changed":false},"copiedPage":"# Secret page\n","canonicalEditorPath":".../outside/poe-code-memory-edit-.../note.md","escaped":true}
```

`editPage()` constructs `tempRoot` as `path.join(root, ".tmp")`, creates a descendant with `fs.mkdtemp()`, and writes the original page into it in `packages/memory/src/edit.ts:17` through `packages/memory/src/edit.ts:32`. It never resolves or validates the temporary directory before performing this copy.

## Expected Behavior

Temporary editor staging must remain within trusted memory-owned storage, or `editPage()` should reject a `.tmp` symlink that redirects writes outside the configured memory root.

## Impact

A repository or memory store containing a crafted `.tmp` symlink can cause ordinary editing of private memory pages to copy their contents outside the expected storage boundary. External processes monitoring that directory can observe sensitive notes even when users cancel or make no edits.
