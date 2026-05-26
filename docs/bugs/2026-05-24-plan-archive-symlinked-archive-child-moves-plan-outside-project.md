# Plan archive symlinked archive child moves plan outside project

## Summary

The exported plan-browser archive action creates its destination beneath an `archive/` child of the selected plan directory without checking whether that child resolves outside the project. With a real `docs/plans` directory but a symlinked `docs/plans/archive`, archiving an otherwise local plan moves its contents into an externally controlled directory.

## Reproduction

From the repository root, run a disposable script that places a local plan beside an `archive` symlink and invokes `archivePlan()`:

```sh
cat > /tmp/plan-browser-symlinked-archive-child-probe.mjs <<'EOF'
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { archivePlan } from '/Users/kjopek/Workspace/poe-code/packages/plan-browser/src/actions.ts';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-archive-child-'));
const plans = path.join(tmp, 'repo', 'docs', 'plans');
const outside = path.join(tmp, 'outside');
await fs.mkdir(plans, { recursive: true });
await fs.mkdir(outside, { recursive: true });
await fs.writeFile(path.join(plans, 'feature.md'), '# Local plan\n', 'utf8');
await fs.symlink(outside, path.join(plans, 'archive'));
const archivedPath = await archivePlan({ absolutePath: path.join(plans, 'feature.md') }, fs);
const canonicalArchived = await fs.realpath(archivedPath);
console.log(JSON.stringify({ archivedPath, canonicalArchived, escaped: canonicalArchived.startsWith((await fs.realpath(outside)) + path.sep), contents: await fs.readFile(canonicalArchived, 'utf8') }));
EOF
./node_modules/.bin/tsx /tmp/plan-browser-symlinked-archive-child-probe.mjs
nl -ba packages/plan-browser/src/actions.ts | sed -n '34,45p'
```

## Observed Behavior

The returned archive path looks project-local, but its canonical target is beneath the external directory and contains the moved local plan:

```text
{"archivedPath":".../repo/docs/plans/archive/feature.md","canonicalArchived":".../outside/feature.md","escaped":true,"contents":"# Local plan\n"}
```

`archiveSelectedPlan()` calculates `archiveDir` and `archivedPath` lexically, then calls `fs.mkdir()` and `fs.rename()` directly in `packages/plan-browser/src/actions.ts:34` through `packages/plan-browser/src/actions.ts:45`. It performs no canonical containment validation for the `archive` descendant before moving the source plan.

## Expected Behavior

Archiving a plan from a project plan directory should keep the resulting archived document inside that same canonical plan storage tree, or reject an archive child that is a symlink outside it.

## Impact

A project containing an otherwise unobtrusive `docs/plans/archive` symlink can cause users to move local plan documents into an external directory during a normal archive operation. This creates unexpected data exfiltration and removal from the project without requiring the entire plan directory to be symlinked.
