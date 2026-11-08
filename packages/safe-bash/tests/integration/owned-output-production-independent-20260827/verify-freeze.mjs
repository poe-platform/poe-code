import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
const git = arguments_ => execFileSync('/usr/bin/git', arguments_, { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 2 * 1024 * 1024 });
const baseline = read('BASELINE.json');
const manifest = read('MANIFEST.json');
assert.equal(baseline.baseline, 'a03b9288a6f4b652387be9fefa8faf17ef58b9e7');
assert.equal(baseline.candidate, null);
assert.equal(baseline.packageSha256, null);
assert.equal(baseline.privateEngine, null);
assert.equal(baseline.authorScope.count, 9);
assert.equal(baseline.authorScope.files.length, 9);
assert.equal(baseline.authorScope.streamsRestriction, 'cat-only');
assert.deepEqual(baseline.authorScope.files.filter(entry => !entry.present).map(entry => entry.path), ['src/contracts/output.ts']);
for (const entry of manifest.files) {
  const bytes = readFileSync(path.join(directory, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
let authenticated = 0;
for (const group of [
  { commit: baseline.baseline, files: [...baseline.authorScope.files, ...baseline.preservationInputs] },
  ...baseline.references
]) {
  for (const input of group.files) {
    const entry = git(['ls-tree', group.commit, '--', input.path]).toString().trim();
    if (!input.present) {
      assert.equal(entry, '', input.path);
      continue;
    }
    assert.equal(entry.split(/\s+/)[2], input.gitBlob, input.path);
    const bytes = git(['cat-file', 'blob', input.gitBlob]);
    assert.equal(bytes.length, input.bytes, input.path);
    assert.equal(hash(bytes), input.sha256, input.path);
    authenticated++;
  }
}
console.log(JSON.stringify({ status: 'PREPARATION_ONLY', frozenCases: read('CASES.json').cases.length, authenticatedGitBlobs: authenticated, baselineAbsentHelper: true, candidateCasesExecuted: 0, privateReads: 0 }));
