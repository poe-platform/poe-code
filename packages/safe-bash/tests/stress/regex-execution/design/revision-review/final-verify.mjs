import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./', import.meta.url));
const root = resolve(base, '../../../../..');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const fixed = JSON.parse(readFileSync(resolve(base, 'evidence/fixed-freeze.json')));
for (const [path, expected] of Object.entries(fixed.files)) assert.equal(hash(path), expected, path);
const auditPath = resolve(base, 'evidence/audit.json');
const audit = JSON.parse(readFileSync(auditPath));
const correctedEvidenceHashes = {};
for (const [recordedPath, expected] of Object.entries(audit.evidenceHashes)) {
  assert(recordedPath.startsWith('vidence/'), 'EXPECTED_ORIGINAL_LABEL_TYPO');
  const correctedPath = 'e' + recordedPath;
  assert.equal(hash(resolve(base, correctedPath)), expected, correctedPath);
  correctedEvidenceHashes[correctedPath] = expected;
}
const review = JSON.parse(readFileSync(resolve(base, 'evidence/validation-review.json')));
for (const [path, expected] of Object.entries(review.pinned)) assert.equal(hash(resolve(root, path)), expected, path);
for (const [path, expected] of Object.entries(review.sourceHashes)) assert.equal(hash(resolve(root, path)), expected, path);
for (const [path, expected] of Object.entries(audit.immutableOriginals)) assert.equal(hash(resolve(root, path)), expected, path);
const correction = { utc: new Date().toISOString(), originalAuditSha256: hash(auditPath), originalAuditPreserved: true, originalFailure: { command: 'final evidence hash readback before report commit 8bb3697', code: 'ENOENT', path: 'tests/stress/regex-execution/design/revision-review/vidence/author-ready.txt', cause: 'audit.mjs base already ends with slash; slice(base.length + 1) drops the initial e from evidence path labels. Original hashes were computed from actual correct files.' }, action: 'Correct labels only in this separate readback manifest, preserve original audit/script/results, verify every original digest. No compiler, cohort, native command, Worker or regex rerun.', correctedEvidenceHashes, verified: { fixedIdentities: Object.keys(fixed.files).length, originalEvidenceDigests: Object.keys(correctedEvidenceHashes).length, immutableOriginals: Object.keys(audit.immutableOriginals).length, validationArtifacts: Object.keys(review.pinned).length, currentHandoffSources: Object.keys(review.sourceHashes).length }, newRiskConsumed: 0 };
writeFileSync(resolve(base, 'evidence/final-verification.json'), JSON.stringify(correction, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(correction.verified));
