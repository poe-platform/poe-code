# Plan browser symlinked plan file reads and edits external document

## Summary

Plan-browser discovery accepts individual Markdown symlinks inside a real plan directory because it uses `stat()` and `readFile()` on each entry without checking canonical containment. The exported edit action then passes the symlink path to the editor, allowing an apparently local plan entry to disclose and overwrite an external Markdown document.

## Reproduction

From the repository root, run a disposable script that places a `local.md` symlink in `docs/plans`, discovers it, and simulates an editor writing through the selected entry:

```sh
cat > /tmp/plan-browser-symlinked-plan-file-probe.mjs <<'EOF'
import * as syncFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverAllPlans, editFile } from '/Users/kjopek/Workspace/poe-code/packages/plan-browser/src/index.ts';
import { resolveConfigPath, resolveProjectConfigPath } from '/Users/kjopek/Workspace/poe-code/packages/poe-code-config/src/index.ts';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-file-link-'));
const cwd = path.join(tmp, 'repo');
const homeDir = path.join(tmp, 'home');
const plans = path.join(cwd, 'docs', 'plans');
const outside = path.join(tmp, 'outside.md');
await fs.mkdir(plans, { recursive: true });
await fs.mkdir(homeDir, { recursive: true });
await fs.writeFile(outside, '# External secret\n', 'utf8');
await fs.symlink(outside, path.join(plans, 'local.md'));
const planFs = {
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  readdir: fs.readdir,
  stat: async (filePath) => { const s = await fs.stat(filePath); return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory(), mtimeMs: s.mtimeMs }; },
  mkdir: fs.mkdir,
  rename: fs.rename,
  unlink: fs.unlink,
};
const entries = await discoverAllPlans({ cwd, homeDir, fs: planFs, configPath: resolveConfigPath(homeDir), projectConfigPath: resolveProjectConfigPath(cwd) });
editFile(entries[0].absolutePath, { env: { EDITOR: 'probe-editor' }, spawnSync: (_editor, args) => { syncFs.writeFileSync(args[0], '# Edited externally\n', 'utf8'); return {}; } });
console.log(JSON.stringify({ discoveredTitle: entries[0].title, externalContents: await fs.readFile(outside, 'utf8') }));
EOF
./node_modules/.bin/tsx /tmp/plan-browser-symlinked-plan-file-probe.mjs
nl -ba packages/plan-browser/src/discovery.ts | sed -n '126,189p'
nl -ba packages/plan-browser/src/actions.ts | sed -n '12,31p'
```

## Observed Behavior

Discovery loads the external document title through the local-looking symlink, and editing the discovered entry overwrites the external target:

```text
{"discoveredTitle":"External secret","externalContents":"# Edited externally\n"}
```

`discoverSharedPlans()` builds an entry path from each filename, follows it with `stat()`, and reads its contents in `packages/plan-browser/src/discovery.ts:126` through `packages/plan-browser/src/discovery.ts:189`. `editFile()` then launches an editor on that same unchecked absolute path in `packages/plan-browser/src/actions.ts:12` through `packages/plan-browser/src/actions.ts:31`.

## Expected Behavior

Discovery and edits should operate only on plan files canonically contained within the configured plan directory, rejecting an individual symlink whose target lies outside that directory.

## Impact

A compromised project can present external notes or configuration as selectable plans and induce users to overwrite those external files through normal browsing and editing. This boundary escape applies even when `docs/plans` itself is a genuine local directory.
