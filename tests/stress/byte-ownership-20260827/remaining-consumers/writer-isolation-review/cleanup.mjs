import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, git, review, root, save, sha256 } from './harness.mjs';

const baseline = JSON.parse(readFileSync(join(review, 'execution/baseline-result.json')));
const candidate = JSON.parse(readFileSync(join(review, 'execution/candidate-result.json')));
for (const change of baseline.changes) {
  const retained = join(review, 'execution/baseline-affected', `${change.path}.data`);
  assert.equal(sha256(readFileSync(retained)), change.after.sha256);
  assert.equal(sha256(readFileSync(join(baseline.directory, change.path))), change.after.sha256);
}
for (const output of candidate.outputs) {
  assert.equal(existsSync(output.directory), false);
  assert.ok(existsSync(join(review, 'execution/captures', output.label, 'manifest.json.data')));
}
const before = JSON.parse(readFileSync(join(review, 'frozen/baseline.json')));
const historical = before.pins.filter(row => row.path.startsWith(`${fixture}/artifacts/`) || row.path.endsWith('/expectations.json') || row.path.endsWith('/source-pin.json'));
for (const row of historical) assert.equal(sha256(readFileSync(join(root, row.path))), row.sha256);
const scratch = join(review, '.scratch');
assert.ok(lstatSync(scratch).isDirectory() && !lstatSync(scratch).isSymbolicLink());
const entries = readdirSync(scratch).sort();
assert.deepEqual(entries, ['baseline-b494-retained', 'baseline-b494-retained.tar.gz', 'candidate-clean', 'candidate-clean.tar.gz', 'capture-temp', 'failure-copy', 'failure-source.tar.gz']);
rmSync(scratch, { recursive: true });
save('execution/cleanup.json', {
  completedAt: new Date().toISOString(), scratch, entries, removed: !existsSync(scratch),
  preservedFailedCopy: 'Exact affected files and complete before/after manifests retained in execution/baseline-affected and execution/baseline-tests-{before,after}.json; not restored',
  preservedFailureControl: 'execution/failure-copy-body.ts.data and execution/captures/failure retain modified owned-copy source and observed failure',
  historicalSharedFiles: historical, allSharedHistoricalHashesUnchanged: true,
  noHiddenDiscoveryExclusions: 'No config/exclusion changes. Full temporary archive trees removed only after permanent failed-byte snapshots and manifests verified, preventing nested test discovery.',
  gitStatusAtCleanup: git('status', '--porcelain=v1').toString(), foreignIndexAtCleanup: git('diff', '--cached', '--name-status').toString(),
});
console.log('Exact owned scratch removed; all failed bytes/manifests and historical shared hashes preserved.');
