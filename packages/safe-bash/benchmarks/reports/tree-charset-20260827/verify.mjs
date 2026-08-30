import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const candidate = 'f1a90436c45208ca248e058a039893233c608daa';
const baseline = '45baf7647124282bf52cd843656b6e190746580a';
const parent = '643439ad70b0ada46eef2c073aceeba3246866ad';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const json = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
const seal = await json('SEAL.json');
assert.deepEqual((await readdir(directory)).sort(), [...Object.keys(seal), 'SEAL.json'].sort());
for (const [name, expected] of Object.entries(seal)) {
  assert.ok((await lstat(join(directory, name))).isFile(), name);
  assert.equal(hash(await readFile(join(directory, name))), expected, name);
}
const before = JSON.parse(git(['show', `${baseline}:benchmarks/reports/tree-breadth-proposal-20260827/RESULT.json`]));
const after = await json('BREADTH.json');
const frozen = await json('FROZEN.json');
assert.equal(after.candidate, candidate);
assert.equal(frozen.candidate, candidate);
assert.equal(frozen.baseline, baseline);
assert.equal(frozen.allPhasesPass, true);
assert.equal(frozen.revisions[0].phases[0].counts.tests, 77);
assert.equal(frozen.revisions[1].phases[0].counts.tests, 139);
for (const revision of frozen.revisions) for (const phase of revision.phases) {
  assert.equal(phase.exitCode, 0); assert.equal(phase.signal, null); assert.equal(phase.error, null);
  if ('tests' in phase.counts) { assert.equal(phase.counts.fail, 0); assert.equal(phase.counts.skipped, 0); }
}
assert.equal(before.rows.length, 34); assert.equal(after.rows.length, 34);
const closed = [];
for (const [index, row] of after.rows.entries()) {
  const original = before.rows[index];
  for (const field of ['id', 'args', 'env', 'native']) assert.deepEqual(row[field], original[field], `${row.id}: ${field}`);
  assert.equal(row.exactMatch, JSON.stringify(row.native) === JSON.stringify(row.virtual));
  if (!original.exactMatch && row.exactMatch) closed.push(row.id);
  if (original.exactMatch) assert.equal(row.exactMatch, true, `previous match regressed ${row.id}`);
}
assert.deepEqual(closed, ['charset-utf8-all', 'charset-utf8-lang', 'charset-ctype-precedence', 'charset-empty-all', 'charset-tree-utf8']);
assert.deepEqual(after.rows.filter(row => !row.exactMatch).map(row => row.id), ['count-mixed-roots', 'names-utf8', 'names-utf8-ascii-branches']);
const totals = stdout => stdout.startsWith('[') ? JSON.parse(stdout).at(-1) : stdout.match(/\n(\d+ director(?:y|ies)(?:, \d+ files?)?)\n$/)[1];
for (const row of after.rows.filter(row => row.id.startsWith('count-'))) assert.deepEqual(totals(row.virtual.stdout), totals(row.native.stdout));
assert.equal(after.shellResult.stdout, before.shellResult.stdout);
const originalDriver = git(['show', `${baseline}:benchmarks/reports/tree-breadth-proposal-20260827/probe.mjs`]).toString();
const driver = await readFile(join(directory, 'replay-breadth.mjs'), 'utf8');
assert.equal(driver.replace(candidate, before.candidate), originalDriver);
assert.equal(git(['rev-parse', `${candidate}^`]).toString().trim(), parent);
assert.equal(git(['diff', '--name-only', baseline, parent, '--', 'src', 'tests/commands/tree', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString(), '');
const changed = git(['diff', '--name-only', parent, candidate]).toString().trim().split('\n').sort();
assert.deepEqual(changed, ['src/commands/tree/README.md', 'src/commands/tree/arguments.ts', 'src/commands/tree/charset.ts',
  'tests/commands/tree/charset-selection.test.ts', 'tests/commands/tree/report-counts.test.ts'].sort());
const preserved = git(['ls-tree', '-r', '--name-only', baseline, '--', 'src/commands/tree', 'tests/commands/tree',
  'benchmarks/reports/current-comparison-20260827/next-handoff', 'benchmarks/reports/baseline-only-20260827/coverage-execution/cases.mjs'])
  .toString().trim().split('\n').filter(name => !changed.includes(name));
for (const name of preserved) assert.deepEqual(git(['show', `${candidate}:${name}`]), git(['show', `${baseline}:${name}`]), name);
assert.equal((await json('NATIVE-EDGES.json')).rows.length, 34);
const checks = { candidate, baseline, parent, baselineToParentSelectedInputDifferences: 0, exactSourceWriteSet: changed, preservedFiles: preserved.length,
  unchangedInputsAndNativeOutputs: 34, beforeMatches: 26, beforeDifferences: 8, candidateMatches: 31, candidateDifferences: 3,
  closed, countTotalsMatched: 15, oldStrictShellOutputUnchanged: true, reversibleDriverRebinding: true,
  beforeTests: 77, candidateTests: 139, newTests: 62, skips: 0, scopedTypesAndSourceBuild: 'both revisions pass',
  driverSha256: hash(driver), originalDriverSha256: hash(originalDriver), noProductFallbackOrFullGateClaim: true };
assert.deepEqual(checks, await json('checks.json'));
process.stdout.write(JSON.stringify(checks, null, 2) + '\n');
