import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, git, sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { artifact } from './artifacts.mjs';

const auditCommit = '96db59ac7d355d1a94422634b4c4f53d00932ad9';
const reviewCommit = '8eb2c80351b212224df15eb9d75e02036ac60cb9';
const sourceCommit = '0278a3032d7851de4c2f5141bbc863cdf310c39d';
const authorFreezeCommit = '8aaf610d26e8dc310bf6ac1f713cf2614cc1120e';
function verifyTree(commit, prefix, expectedCount) {
  const paths = git(['ls-tree', '-r', '--name-only', commit, '--', ...[prefix].flat()]).toString().trim().split('\n');
  if (expectedCount !== undefined) assert.equal(paths.length, expectedCount);
  return paths.map(path => {
    const expected = digest(git(['show', `${commit}:${path}`]));
    const actual = digest(readFileSync(path));
    assert.equal(actual, expected, path);
    return { path, sha256: actual };
  });
}
const before = sourceSnapshot();
const audit = verifyTree(auditCommit, ['benchmarks/reports/current-integration', 'tests/commands/structured', 'tests/commands/structured-stress'], 170);
const priorReview = verifyTree(reviewCommit, 'tests/commands/structured-stress/jq-42-independent-review', 28);
const baseline = JSON.parse(readFileSync(new URL('../jq-42-review-fixes/immutable-before.json', import.meta.url)));
const priorEvidence = Object.entries(baseline.files).map(([path, expected]) => {
  assert.equal(digest(git(['show', `${baseline.head}:${path}`])), expected, `baseline commit ${path}`);
  assert.equal(digest(readFileSync(path)), expected, path);
  return { path, sha256: expected };
});
assert.equal(priorEvidence.length, 139);
const freezePath = 'tests/commands/structured-stress/jq-42-review-fixes/native-frozen.json';
assert.deepEqual(readFileSync(freezePath), git(['show', `${authorFreezeCommit}:${freezePath}`]));
const sourceChanges = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sourceCommit]).toString().trim().split('\n');
assert.deepEqual(sourceChanges, ['src/commands/structured/input.ts', 'src/commands/structured/jq.ts']);
const structured = verifyTree(sourceCommit, 'src/commands/structured');
const authorEvidenceCommit = git(['log', '-1', '--format=%H', '--', 'tests/commands/structured-stress/jq-42-review-fixes/REPORT.json']).toString().trim();
const authorEvidence = verifyTree(authorEvidenceCommit, 'tests/commands/structured-stress/jq-42-review-fixes');
const after = sourceSnapshot();
artifact(process.argv[2], { recordedAt: new Date().toISOString(), before, after,
  stable: before.productSha256 === after.productSha256, auditCommit, reviewCommit, sourceCommit, authorFreezeCommit,
  authorEvidenceCommit, baselineCommit: baseline.head, audit, priorReview, priorEvidence, authorEvidence,
  authorFreezeSha256: digest(readFileSync(freezePath)), sourceChanges, structured });
console.log(JSON.stringify({ audit: audit.length, priorReview: priorReview.length, priorEvidence: priorEvidence.length,
  authorEvidence: authorEvidence.length, authorEvidenceCommit, sourceChanges, stable: before.productSha256 === after.productSha256 }));
