import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEvidence, transports } from '../jq-42-independent-review/evidence.mjs';
import { directory, root, digest, newTransports } from './common.mjs';

export function loadFrozen() {
  const manifestBytes = readFileSync(join(directory, 'manifest.json'));
  const manifestSha256 = readFileSync(join(directory, 'MANIFEST.sha256'), 'utf8').trim().split(/\s+/u)[0];
  assert.equal(digest(manifestBytes), manifestSha256, 'manifest seal');
  const manifest = JSON.parse(manifestBytes);
  for (const [path, sha256] of Object.entries({ ...manifest.historicalFiles, ...manifest.ownedFiles })) {
    assert.equal(digest(readFileSync(join(root, path))), sha256, `frozen file changed: ${path}`);
  }
  const native = JSON.parse(readFileSync(join(directory, 'native-frozen.json')));
  assert.equal(native.specificationSha256, digest(readFileSync(join(directory, 'cases.mjs'))));
  const main = loadEvidence();
  const legacy = JSON.parse(readFileSync(new URL('../jq-42-independent-review/legacy-native-proof.json', import.meta.url)));
  const cohorts = {
    grammar: native.cases.map(vector => ({ ...vector, cohort: 'grammar', schedules: newTransports(vector) })),
    main: main.vectors.map(vector => ({ ...vector, schedules: transports(vector) })),
    legacy: legacy.probes.map(vector => ({ ...vector, cohort: 'legacy', schedules: ['whole', 'bytewise'] })),
  };
  const counts = Object.fromEntries(Object.entries(cohorts).map(([name, vectors]) => [name, { vectors: vectors.length, executions: vectors.reduce((sum, vector) => sum + vector.schedules.length * 2, 0) }]));
  assert.deepEqual(counts, manifest.counts);
  for (const vector of Object.values(cohorts).flat()) {
    assert.match(vector.inputHex, /^(?:[a-f0-9]{2})*$/u);
    if (vector.inputSha256) assert.equal(digest(Buffer.from(vector.inputHex, 'hex')), vector.inputSha256);
  }
  return { manifest, manifestSha256, native, main, cohorts, counts };
}
