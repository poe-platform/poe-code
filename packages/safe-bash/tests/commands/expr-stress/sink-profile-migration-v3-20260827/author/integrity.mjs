import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../../../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
export const manifest = JSON.parse(readFileSync(join(owned, 'MANIFEST.json')));
export function inventory(directory) {
  const records = {};
  function walk(current, prefix = '') {
    for (const name of readdirSync(current).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = join(current, name), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) records[path] = { kind: 'symlink', target: readlinkSync(absolute) };
      else if (stat.isDirectory()) { records[path] = { kind: 'directory' }; walk(absolute, path); }
      else records[path] = { kind: 'file', bytes: stat.size, sha256: hash(readFileSync(absolute)) };
    }
  }
  walk(directory);
  return records;
}
export function verifyInputs() {
  const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
  assert.equal(hash(readFileSync(join(owned, 'MANIFEST.json'))), freeze.manifestSha256);
  for (const file of freeze.files) {
    const bytes = readFileSync(join(owned, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
  for (const folder of ['original', 'revised', 'support', 'historical']) {
    const expected = {};
    for (const file of freeze.files.filter(file => file.path.startsWith(`${folder}/`))) {
      const relative = file.path.slice(folder.length + 1);
      const parts = relative.split('/');
      for (let length = 1; length < parts.length; length++) expected[parts.slice(0, length).join('/')] = { kind: 'directory' };
      expected[relative] = { kind: 'file', bytes: file.bytes, sha256: file.sha256 };
    }
    assert.deepEqual(inventory(join(owned, folder)), expected, folder);
  }
  for (const file of manifest.records.filter(file => file.originalCommit)) {
    const bytes = git('show', `${file.originalCommit}:${file.originalPath}`);
    assert.equal(hash(bytes), file.originalSha256 ?? file.sha256, file.originalPath);
    if (file.originalPath !== 'tests/commands/expr/contracts.test.ts') assert.equal(hash(readFileSync(join(root, file.originalPath))), hash(bytes), file.originalPath);
  }
  assert.equal(hash(readFileSync(join(root, 'tests/commands/expr/contracts.test.ts'))), hash(readFileSync(join(owned, 'revised/canonical/contracts.test.ts.data'))));
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', manifest.canonicalCommit).toString().trim(), 'tests/commands/expr/contracts.test.ts');
  git('merge-base', '--is-ancestor', manifest.quotaAncestor, manifest.candidate);
  return { manifestSha256: freeze.manifestSha256, freezeSha256: hash(readFileSync(join(owned, 'FREEZE.json'))), frozenFileCount: freeze.files.length, appendAwareFrozenDirectories: ['original', 'revised', 'support', 'historical'] };
}
