import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { owned, root, work, save, hash } from './prepare.mjs';
const provenance = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const originalPath = join(provenance.source, 'tests/commands/expr-stress/diagnostics-candidate-review/replay/accept-controls.mjs');
const original = readFileSync(originalPath, 'utf8');
const delta = [
  ["from './watchdog.mjs'", `from ${JSON.stringify(join(provenance.source, 'tests/commands/expr-stress/diagnostics-candidate-review/replay/watchdog.mjs'))}`],
  ["from './review.mjs'", "from './core-bindings.mjs'"],
  ["const stage = JSON.parse(readFileSync(`${owned}/candidate-diagnostics/stage.json`));", `const stage = ${JSON.stringify({ installed: provenance.installed, commit: provenance.candidate, installedArtifactSha256: provenance.artifactSha256 })};`],
  ["join(tmpdir(), 'expr-final-real-vfs-')", `join(${JSON.stringify(work)}, 'expr-final-real-vfs-')`],
];
let bound = original;
for (const [before, after] of delta) { assert.equal(bound.split(before).length, 2); bound = bound.replace(before, after); }
const path = relative(root, join(owned, 'core-bound.mjs'));
const patch = `*** Begin Patch\n*** Add File: ${path}\n${bound.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
const applied = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8' });
assert.equal(applied.status, 0, applied.stderr);
save('core-binding-deltas.json', { originalPath, originalSha256: hash(original), boundSha256: hash(bound.trimEnd() + '\n'), delta, assertionOrInputChanges: false, qualification: 'Only import, installed stage, output sink, frozen Git input and scratch-path bindings. All assertions in accept-controls preserved byte-for-byte outside these four exact replacements. Controls are reused independently executed, not independently authored.' });
