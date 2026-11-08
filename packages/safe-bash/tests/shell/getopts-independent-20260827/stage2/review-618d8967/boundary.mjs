import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { own, repo, candidate, author, freeze, git, hash } from './harness.mjs';

const review = path.relative(repo, own);
const stage = path.dirname(review);
const phase = path.dirname(stage);
const blobId = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function members(root, exclude = () => false) {
  const found = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const child = relative ? `${relative}/${name}` : name;
      if (exclude(child)) continue;
      const filename = path.join(root, child);
      const stat = fs.lstatSync(filename);
      assert(!stat.isSymbolicLink(), `unapproved symlink ${filename}`);
      if (stat.isDirectory()) { found[child + '/'] = { kind: 'directory' }; visit(child); }
      else { assert(stat.isFile()); const bytes = fs.readFileSync(filename); found[child] = { kind: 'file', mode: stat.mode & 0o111 ? '100755' : '100644', bytes: bytes.length, sha256: hash(bytes), oid: blobId(bytes) }; }
    }
  }
  visit('');
  return found;
}
function compareOriginal(root, commit, exclude) {
  const prefix = root + '/';
  const expected = {};
  const directories = new Set();
  for (const record of git('ls-tree', '-r', '-z', commit, '--', root).toString().split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const full = record.slice(tab + 1);
    assert(full.startsWith(prefix));
    const name = full.slice(prefix.length);
    if (exclude(name)) continue;
    assert.equal(type, 'blob');
    expected[name] = { mode, oid };
    let parent = path.dirname(name);
    while (parent !== '.') { directories.add(parent + '/'); parent = path.dirname(parent); }
  }
  const live = members(path.join(repo, root), exclude);
  assert.deepEqual(Object.keys(live).sort(), [...Object.keys(expected), ...directories].sort(), `original membership ${root}`);
  for (const [name, entry] of Object.entries(expected)) { assert.equal(live[name].oid, entry.oid, name); assert.equal(live[name].mode, entry.mode, name); }
  return { files: Object.keys(expected).length, entries: Object.keys(live).length, appendAware: true };
}
export function authenticateBoundary() {
  const phase1 = compareOriginal(phase, '4f84fdfd41134710cdb68fab3f5970cb14e54da3', name => name === 'stage2' || name.startsWith('stage2/'));
  const policyNames = ['POLICY-v2.md', 'policy-invariants-v2.json', 'policy-v2-manifest.json'];
  const stage2 = compareOriginal(stage, '592c864ef62f5a29b1f126c83b6ac532357fb599', name => policyNames.includes(name) || name === 'review-618d8967' || name.startsWith('review-618d8967/'));
  for (const name of policyNames) assert(fs.readFileSync(path.join(repo, stage, name)).equals(git('show', `bf3bfd63204ddd8fc5dbfa7308b77444de51d6f7:${stage}/${name}`)));
  const frozen = git('ls-tree', '-r', '--name-only', freeze, '--', review).toString().trim().split('\n');
  assert.equal(frozen.length, 7);
  for (const name of frozen) assert(fs.readFileSync(path.join(repo, name)).equals(git('show', `${freeze}:${name}`)), `frozen review drift ${name}`);
  const baseline = JSON.parse(git('show', `${author}:tests/shell/getopts/runtime/baseline.json`));
  for (const [name, expected] of Object.entries(baseline.protectedPaths)) assert.equal(hash(git('show', `${candidate}:${name}`)), expected, name);
  return { phase1, stage2, policyFiles: 3, frozenReviewFiles: 7, protectedCandidateHashes: Object.keys(baseline.protectedPaths).length, oldVerifiersInvoked: false, originalExclusions: { phase1: ['stage2/'], stage2: [...policyNames, 'review-618d8967/'] }, qualification: 'Original trees plus exact authorized layered appends; no arbitrary unknown exclusion or live product overlay.' };
}
