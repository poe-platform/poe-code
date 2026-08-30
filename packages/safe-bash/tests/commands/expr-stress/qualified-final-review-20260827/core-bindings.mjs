import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { owned as evidence, hash, git, inventory, save } from './prepare.mjs';
const provenance = JSON.parse(readFileSync(join(evidence, 'provenance.json')));
export const owned = join(provenance.source, 'tests/commands/expr-stress/diagnostics-candidate-review/replay');
export const originalCommit = '35aa8054ac0ebc1eacefc7cde63e4706f4c72137';
export const extensionCommit = '92fe8a63';
export const originalBase = 'tests/commands/expr-stress/frozen';
export const extensionBase = 'tests/commands/expr-stress/extension-review/frozen';
export const sha256 = hash;
export const frozenJson = (commit, path) => JSON.parse(git('show', `${commit}:${path}`));
export function verifyFrozen() {
  return [originalBase, extensionBase].map((base, index) => {
    const commit = index ? extensionCommit : originalCommit;
    const files = inventory(join(provenance.source, base)).filter(entry => entry.type === 'file');
    const names = git('ls-tree', '-r', '--name-only', commit, '--', base).toString().trim().split('\n');
    assert.deepEqual(files.map(entry => `${base}/${entry.path}`).sort(), names.sort());
    for (const entry of files) assert.equal(entry.sha256, hash(git('show', `${commit}:${base}/${entry.path}`)));
    return { base, commit, files, addedEntryDetection: true };
  });
}
export function addEvidence(path, value) {
  assert(path.startsWith(owned + '/'));
  save('core-controls.json', value);
}
