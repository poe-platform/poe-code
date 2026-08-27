import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base, git, hash, save } from './replay.mjs';

const gate = JSON.parse(readFileSync(`${base}/final-gate.json`, 'utf8'));
const directory = resolve(base, '.scratch/final-corrected');
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', directory], { input: git('archive', gate.revision, 'tests/commands/diff-patch') });
const freeze = JSON.parse(readFileSync(`${base}/initial-freeze.json`, 'utf8'));
const names = freeze.failures.map(row => ({ original: row.name, corrected: row.classification === 'atomic-status-needs-review'
  ? 'atomic extension repeated backward hunk is a conflict without publication'
  : row.classification === 'stripped-header-expectation'
    ? 'quoted-path security: GNU default strips the unselected symlink ancestor and changes only basenames'
    : row.classification === 'artifact-hash-expectation'
      ? 'all seven captured author artifacts authenticate immutable handoff source and oracle' : row.name }));
const pattern = `^(?:${names.map(row => row.corrected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;
const matcher = ['tests/commands/diff-patch/patch-gnu-coordinates.test.ts', 'tests/commands/diff-patch/patch-hunk-diagnostics-followup.test.ts', 'tests/commands/diff-patch/hunk-regressions.test.ts', 'tests/commands/diff-patch/patch-gnu-publication.test.ts', 'tests/commands/diff-patch-stress/fuzz/properties.test.ts', 'tests/commands/diff-patch-stress/gnu-target/edit-correctness.test.ts'];
const unchanged = matcher.map(path => {
  const current = hash(readFileSync(resolve(directory, path)));
  assert.equal(current, hash(git('show', `ee4eed6:${path}`)));
  return { path, sha256: current };
});
for (const [label, expected, args] of [
  ['final-corrected31', 31, ['--test-name-pattern', pattern, ...freeze.targets]],
  ['final-unchanged-matcher164', 164, matcher],
]) {
  const argv = ['--import', 'tsx', '--test', '--test-concurrency=1', ...args];
  const result = spawnSync(process.execPath, argv, { cwd: directory, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TMPDIR: resolve(base, '.scratch') }, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  save(`${base}/${label}.json`, { revision: gate.revision, argv, names: label === 'final-corrected31' ? names : undefined, unchanged, status: result.status, signal: result.signal, error: result.error?.message, counts, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(counts, { tests: expected, pass: expected, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  console.log(label, counts);
}
const reportPath = 'tests/commands/diff-patch-stress/evidence/fullgate-51282a9-followup/acceptance-result.json';
const reportBytes = git('show', `${gate.revision}:${reportPath}`);
const report = JSON.parse(reportBytes);
const source = Object.fromEntries(Object.entries(report.before.files).map(([path, entry]) => {
  assert.equal(hash(git('show', `${gate.revision}:${path}`)), entry.sha256);
  assert.equal(hash(entry.text), entry.sha256);
  return [path, entry.sha256];
}));
assert.equal(hash(JSON.stringify(source)), report.before.aggregate);
assert.equal(report.before.aggregate, '7943828f6a3cda1626a0cd6685b4e1950f75b5fae690fa16977b1451a0b8f75d');
assert.equal(report.snapshotInputsUnchanged, true);
assert.equal(report.results.length, 17);
assert(report.results.every(row => row.censusMatches && row.status === 0 && row.counts.failed === 0 && row.counts.skipped === 0));
assert.equal(report.results.reduce((sum, row) => sum + row.counts.tests, 0), 3758);
save(`${base}/author3758-evidence-authentication.json`, { reportPath, revision: gate.revision, reportSha256: hash(reportBytes), source, aggregate: report.before.aggregate, reportedTotals: report.totals, censusGroups: 17, independentRuntimeRerun: false, limitation: 'Independent verification of committed report/source binding and reported census arithmetic only. Author3758 results are not promoted to independent fullgate/runtime acceptance. Original3750pass8fail preserved.' });
