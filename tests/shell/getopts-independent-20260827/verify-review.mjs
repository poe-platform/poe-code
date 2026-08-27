import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inventory } from './review-lib.mjs';

const owned = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
const repository = path.resolve(owned, '../../..');
const seal = JSON.parse(fs.readFileSync(path.join(owned, 'review-manifest.json'), 'utf8'));
const current = inventory(owned); delete current['review-manifest.json']; assert.deepEqual(current, seal.entries, 'complete review membership/hash seal');
for (const directory of ['capture-01', 'capture-followup-02', 'capture-corrected-03']) {
  const root = path.join(owned, directory); const expected = JSON.parse(fs.readFileSync(path.join(root, 'artifact-manifest.json'), 'utf8')); const actual = inventory(root); delete actual['artifact-manifest.json']; assert.deepEqual(actual, expected, directory);
}
const freeze = JSON.parse(fs.readFileSync(path.join(owned, 'freeze-manifest.json'), 'utf8'));
for (const file of ['freeze-manifest.json', ...Object.keys(freeze.controls)]) {
  const result = spawnSync('git', ['show', `7a47dcdba6175a4eccc9dad16c3ac9733cf0e0bf:tests/shell/getopts-independent-20260827/${file}`], { cwd: repository }); assert.equal(result.status, 0); assert.deepEqual(fs.readFileSync(path.join(owned, file)), result.stdout, file);
}
for (const mode of ['source', 'moved', 'source-repeat', 'moved-repeat']) {
  const run = JSON.parse(fs.readFileSync(path.join(owned, `capture-01/${mode}.json`), 'utf8'));
  assert.deepEqual(run.counts, { total: 238, pass: 237, fail: 1 });
  assert.deepEqual(run.results.filter((row) => row.status === 'fail').map((row) => row.id), ['P03/reset-clones']);
  assert.equal(run.results.filter((row) => row.id.startsWith('S') && row.status === 'pass').length, 85);
  assert.equal(new Set(run.results.filter((row) => row.id.startsWith('P')).map((row) => row.id.split('/')[0])).size, 32);
}
for (const mode of ['source', 'moved']) {
  const types = JSON.parse(fs.readFileSync(path.join(owned, `capture-followup-02/types-${mode}.json`), 'utf8')); assert.deepEqual(types.counts, { total: 28, pass: 28, fail: 0 });
  assert.equal(types.results.filter((row) => row.negative).length, 26);
  const corrected = JSON.parse(fs.readFileSync(path.join(owned, `capture-corrected-03/corrected-${mode}.json`), 'utf8')); assert.deepEqual(corrected.counts, { total: 3, pass: 3, fail: 0 });
}
for (const profile of ['bash53', 'bash32']) {
  const native = JSON.parse(fs.readFileSync(path.join(owned, `capture-01/native-${profile}.json`), 'utf8')); assert.deepEqual(native.counts, { scripts: 12, pass: 12, fail: 0, records: 71, passedRecords: 71 });
}
const mutants = JSON.parse(fs.readFileSync(path.join(owned, 'capture-followup-02/mutation-baseline-audit.json'), 'utf8')); assert.equal(mutants.length, 16); assert(mutants.every((row) => row.status === 'killed' && row.loadPassed && row.witnesses.length));
assert.deepEqual(mutants.find((row) => row.id === 'M03').excludedBaselineFailures, ['P03/reset-clones']);
assert(!Object.keys(current).some((filename) => filename.endsWith('.ts') || filename.endsWith('.mts') || filename.startsWith('scratch-')));
console.log(JSON.stringify({ integrity: 'pass', frozenFilesUnchanged: 8, originalFrozenRuntime: '237/238 per mode/run; P03 oracle defect retained', correctedTypes: '28/28 per mode', nativeFrozen: '12 scripts/71 records per profile', mutants: '16 baseline-discriminating kills', noCandidateOrOracleExecutedByVerifier: true }));
