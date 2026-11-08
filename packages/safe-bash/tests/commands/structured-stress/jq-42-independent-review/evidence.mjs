import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesResult, digest, directory, frozenFile } from './common.mjs';

export const manifestSha256 = 'f4636b95d52c78b118c5eebc4a802ccf13d63a8a43c460f55da91e9f4e6ceacb';
export function loadEvidence() {
  const manifestBytes = readFileSync(join(directory, 'manifest.json'));
  assert.equal(digest(manifestBytes), manifestSha256, 'frozen manifest');
  const manifest = JSON.parse(manifestBytes);
  for (const item of [manifest.audit, manifest.handoff]) assert.equal(digest(frozenFile(item.path)), item.sha256);
  const historical = manifest.cohorts.flatMap(cohort => {
    const bytes = frozenFile(cohort.path);
    assert.equal(digest(bytes), cohort.sha256, cohort.path);
    const data = JSON.parse(bytes);
    assert.equal(data.cases.length, cohort.count);
    return data.cases.map(vector => ({ ...vector, cohort: cohort.cohort, expected: bytesResult(vector.expected) }));
  });
  const independentBytes = readFileSync(join(directory, manifest.independent.path));
  assert.equal(digest(independentBytes), manifest.independent.sha256, 'independent native bytes');
  assert.equal(digest(readFileSync(join(directory, 'cases.mjs'))), manifest.independent.caseSpecificationSha256);
  const independent = JSON.parse(independentBytes).cases.map(vector => ({ ...vector, cohort: 'reviewer' }));
  const vectors = [...historical, ...independent];
  assert.equal(new Set(vectors.map(vector => vector.id)).size, 256);
  for (const vector of vectors) {
    assert.equal(digest(Buffer.from(vector.inputHex, 'hex')), vector.inputSha256, `${vector.id} input`);
    for (const field of ['stdout', 'stderr']) {
      const hash = vector[`${field}Sha256`];
      if (hash) assert.equal(digest(Buffer.from(vector.expected[`${field}Hex`], 'hex')), hash, `${vector.id} ${field}`);
    }
  }
  const original = new Set(manifest.original42.map(vector => `${vector.cohort}:${vector.id}`));
  assert.equal(vectors.filter(vector => original.has(`${vector.cohort}:${vector.id}`)).length, 42);
  return { manifest, historical, independent, vectors, original };
}
export function transports(vector) {
  if (!vector.allBoundaries) return [vector.transport === 'bytewise' ? 'bytewise' : 'whole'];
  const length = Buffer.from(vector.inputHex, 'hex').length;
  return ['whole', 'bytewise', ...Array.from({ length: Math.max(0, length - 1) }, (_, index) => `split:${index + 1}`)];
}
