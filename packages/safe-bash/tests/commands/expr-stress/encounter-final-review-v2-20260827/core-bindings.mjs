import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, '../../../..');
export const owned = join(evidence, 'core-drivers');
export const originalCommit = '35aa8054ac0ebc1eacefc7cde63e4706f4c72137';
export const extensionCommit = '92fe8a63';
export const originalBase = 'tests/commands/expr-stress/frozen';
export const extensionBase = 'tests/commands/expr-stress/extension-review/frozen';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
export const frozenJson = (commit, filename) => JSON.parse(git('show', `${commit}:${filename}`));
export function verifyFrozen() {
  const records = [];
  for (const [commit, base] of [[originalCommit, originalBase], [extensionCommit, extensionBase]]) {
    const names = git('ls-tree', '-r', '--name-only', commit, '--', base).toString().trim().split('\n');
    const candidateNames = git('ls-tree', '-r', '--name-only', process.env.REVIEW_COMMIT, '--', base).toString().trim().split('\n');
    assert.deepEqual(candidateNames, names);
    for (const filename of names) {
      const expected = sha256(git('show', `${commit}:${filename}`));
      assert.equal(sha256(git('show', `${process.env.REVIEW_COMMIT}:${filename}`)), expected);
      records.push({ filename, commit, sha256: expected });
    }
  }
  const bindings = JSON.parse(readFileSync(join(evidence, 'core-binding-deltas.json')));
  for (const driver of bindings.drivers) assert.equal(sha256(readFileSync(join(owned, driver.filename))), driver.sha256);
  return records;
}
export function addEvidence(filename, value) {
  assert(filename.startsWith(owned + '/'));
  writeFileSync(join(process.env.REVIEW_OUTPUT, 'core-controls.json'), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
