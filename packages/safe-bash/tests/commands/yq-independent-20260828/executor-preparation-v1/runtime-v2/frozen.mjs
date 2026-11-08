import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(root, '../../../../..');
export const originalPrefix = 'tests/commands/yq-independent-20260828/executor-preparation-v1/runtime';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const jsonHash = (value) => sha256(JSON.stringify(value));
export const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 16777216 });

export function regularBytes(filename) {
  const stat = lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16777216, 'Bounded regular input');
  assert.equal(realpathSync(filename), resolve(filename), 'No symlink input path');
  return readFileSync(filename);
}

export function authenticateFrozen() {
  const bindings = JSON.parse(regularBytes(join(root, 'BINDINGS.json')));
  const bytes = new Map();
  for (const entry of bindings.entries) {
    assert(/^[0-9a-f]{40}$/.test(entry.commit));
    const committed = git('show', `${entry.commit}:${entry.path}`);
    assert.equal(sha256(committed), entry.sha256, `Frozen Git hash: ${entry.path}`);
    assert.equal(committed.length, entry.bytes);
    const tree = git('ls-tree', entry.commit, '--', entry.path).toString().trim();
    assert.equal(tree, `${entry.gitMode} blob ${entry.blob}\t${entry.path}`, 'Exact Git mode/blob/path');
    if (entry.liveImmutable) {
      const filename = join(repository, entry.path);
      assert.equal(sha256(regularBytes(filename)), entry.sha256, `Frozen live file: ${entry.path}`);
      assert.equal(lstatSync(filename).mode & 0o777, entry.mode);
    }
    bytes.set(entry.id, committed);
  }
  const original = new Map(bindings.recipeNames.map((name) => [name, bytes.get(`recipe:${name}`)]));
  const seal = JSON.parse(bytes.get('recipe-seal'));
  assert.deepEqual(bindings.recipeNames, seal.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
  assert.deepEqual(readdirSync(join(repository, originalPrefix, 'recipe')).sort(), bindings.recipeNames, 'Frozen live recipe membership');
  assert.equal(jsonHash(seal.entries), seal.treeSha256);
  for (const entry of seal.entries.filter((entry) => entry.kind === 'file')) {
    assert.equal(sha256(original.get(entry.path)), entry.sha256);
    assert.equal(original.get(entry.path).length, entry.bytes);
    assert.equal(sha256(git('show', `${bindings.runtimeEvidenceCommit}:${originalPrefix}/recipe/${entry.path}`)), entry.sha256);
  }
  const inventory = JSON.parse(original.get('inventory.json'));
  assert.deepEqual(inventory.roleCounts, bindings.roleCounts);
  assert.equal(inventory.count, 194);
  const candidate = JSON.parse(bytes.get('candidate-result'));
  assert.deepEqual(candidate.runtimeAdmission.missingBuiltins, ['node:timers/promises']);
  const pending = JSON.parse(bytes.get('candidate-pending'));
  assert.equal(pending.candidateCommit, bindings.candidateCommit);
  assert.equal(pending.source.fileCount, 271);
  assert.equal(pending.sourceArchive.fileCount, 273);
  assert(bytes.get('selected-query-adapter').toString().includes('from "node:timers/promises"'));
  const selectedMap = JSON.parse(bytes.get('candidate-map'));
  assert.equal(selectedMap.revisions.source, bindings.candidateCommit);
  assert.equal(selectedMap.revisions.carry, bindings.contractCommit);
  assert.equal(Object.keys(selectedMap.source.files).length, 271);
  assert.equal(Object.keys(selectedMap.archive.files).length, 273);
  assert.equal(selectedMap.source.files['src/commands/structured/query-core.ts'].sha256, sha256(bytes.get('selected-query-adapter')));
  assert.equal(selectedMap.source.files['src/commands/yq/index.ts'].sha256, sha256(bytes.get('selected-yq-entry')));
  return { bindings, bytes, original, seal };
}
