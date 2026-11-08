import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { canonical, git, review, root, save, sha256 } from './harness.mjs';

const candidate = JSON.parse(readFileSync(join(review, 'execution/candidate-result.json')));
const ready = JSON.parse(readFileSync(join(review, 'execution/author-ready.txt')));
assert.equal(ready.sourceHarnessCommit, candidate.revision);
const authorBindings = Object.entries(ready.files).map(([path, expected]) => {
  const archivedSha256 = sha256(git('show', `${candidate.revision}:${path}`));
  assert.equal(archivedSha256, expected);
  return { path, expected, archivedSha256, currentSha256: sha256(readFileSync(join(root, path))) };
});
const oldTest = readFileSync(join(review, 'frozen/initial/direct-curl.test.ts.data'), 'utf8');
const newTest = git('show', `${candidate.revision}:${canonical}`).toString();
const assertions = source => source.split('\n').filter(line => line.trim().startsWith('assert.'));
assert.deepEqual(assertions(newTest), assertions(oldTest));
const manifest = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else manifest.push({ path: relative(review, path), bytes: readFileSync(path).length, sha256: sha256(readFileSync(path)) });
  }
}
visit(join(review, 'execution'));
const runnerHashes = ['FROZEN_CONTROLS.md', 'freeze.mjs', 'harness.mjs', 'baseline.mjs', 'verify.mjs', 'cleanup.mjs', 'seal.mjs'].map(path => ({ path, sha256: sha256(readFileSync(join(review, path))) }));
const sourcePathsChangedSinceHistorical = git('diff', '--name-only', 'b494675c34dc289f4ad4b10a9201e1211eb0a7d8', candidate.revision, '--', 'src').toString().trim().split('\n').filter(Boolean);
const concurrent = [1, 2].map(number => JSON.parse(readFileSync(join(review, `execution/candidate-concurrent-${number}.json`))));
const concurrentCapture = [1, 2].map(number => JSON.parse(readFileSync(join(review, `execution/candidate-capture-${number}.json`))));
const overlap = children => Math.max(...children.map(child => Date.parse(child.startedAt))) < Math.min(...children.map(child => Date.parse(child.finishedAt)));
assert.ok(overlap(concurrent));
assert.ok(overlap(concurrentCapture));
save('execution/SEAL.json', {
  sealedAt: new Date().toISOString(), authorBindings, assertionsUnchanged: true, exactAssertionLines: assertions(newTest).length,
  completeCandidateSourceBinding: 'candidate-source-before.json', completeCandidateTestFixtureBinding: 'candidate-tests-before.json',
  concurrentCanonicalOverlap: true, concurrentCaptureOverlap: true,
  sourcePathsChangedSinceHistorical, currentCandidateSourceDrift: git('diff', '--name-only', candidate.revision, '--', 'src').toString(),
  runnerHashes, evidence: manifest, evidenceInventorySha256: sha256(JSON.stringify(manifest)),
  executionHarnessProfile: 'Invariant controls frozen before author patch. API-specific harness uses no-argument capture and explicit compiler-cache disabling; exact runnable hashes retained. No frozen invariant/vector changed.',
});
console.log(JSON.stringify({ assertionsUnchanged: assertions(newTest).length, authorBindings: authorBindings.length, evidenceFiles: manifest.length, sourcePathsChangedSinceHistorical }, null, 2));
