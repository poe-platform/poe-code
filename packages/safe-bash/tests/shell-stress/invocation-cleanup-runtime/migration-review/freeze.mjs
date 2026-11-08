import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const candidate = '4bb4ad85d4554889cd6f59097af776f4172e34d1';
const author = '026e20cf38ddbb695d82de3f30cf7a1a7c88f088';
const fixture = 'tests/shell/invocation-cleanup-public.test.ts';
const base = 'tests/shell-stress/invocation-cleanup-runtime';
const probe = `${base}/public-worker.mjs`;
const helper = `${base}/migration/binding.ts`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function git(args) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function tree(directory, baseDirectory = directory) {
  const files = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) Object.assign(files, tree(path, baseDirectory));
    else files[relative(baseDirectory, path)] = digest(readFileSync(path));
  }
  return files;
}
function save(name, value) {
  writeFileSync(join(here, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
const paths = git(['ls-tree', '-r', '--name-only', candidate, '--', 'src']).toString().trim().split('\n');
const configs = new Set();
function config(path) {
  if (configs.has(path)) return;
  assert.ok(!path.includes('..') && !path.startsWith('/'));
  configs.add(path);
  const value = JSON.parse(git(['show', `${candidate}:${path}`]));
  if (value.extends) config(relative(repository, resolve(repository, dirname(path), value.extends)));
}
config('tsconfig.build.json');
paths.push('package.json', 'package-lock.json', ...configs, fixture, probe, helper);
const files = {};
for (const path of paths.sort((left, right) => left.localeCompare(right))) {
  files[path] = digest(git(['show', `${candidate}:${path}`]));
  assert.equal(digest(readFileSync(join(repository, path))), files[path], `Dirty candidate input: ${path}`);
}
const expected = { format: 'public-cleanup-committed-v1', revision: candidate, tree: git(['rev-parse', `${candidate}^{tree}`]).toString().trim(), files };
save('expected-inputs.json', expected);
const oldFixture = git(['show', `85e6d560:${fixture}`]).toString();
const newFixture = git(['show', `${candidate}:${fixture}`]).toString();
const oldProbe = git(['show', `85e6d560:${probe}`]);
assert.equal(digest(oldProbe), files[probe]);
for (const path of [fixture, probe, helper, ...paths.filter(path => path.startsWith('src/'))]) {
  assert.equal(digest(git(['show', `${author}:${path}`])), files[path], `Change since author: ${path}`);
}
const scenarioStart = text => text.slice(text.indexOf('for (const command of ["grep", "rg"])'));
const assertionLines = text => scenarioStart(text).split('\n').filter(line => line.trim().startsWith('assert.') && !line.includes('assert.ok(binding)'));
assert.deepEqual(assertionLines(newFixture), assertionLines(oldFixture));
for (const text of [oldFixture, newFixture]) {
  assert.ok(text.includes('["normal", "early-pipe", "caller-abort", "same-shell-sibling", "other-shell-sibling"]'));
}
const historical = JSON.parse(readFileSync(join(repository, base, 'migration/history/MANIFEST.json')));
for (const entry of historical.entries) {
  const bytes = readFileSync(join(repository, base, 'migration/history', entry.stored));
  assert.equal(digest(bytes), entry.sha256);
  if (entry.source) assert.deepEqual(bytes, git(['show', `${entry.sourceCommit}:${entry.source}`]));
}
for (const [path, hash] of Object.entries(historical.historicalPins)) {
  assert.equal(digest(git(['show', `${historical.historicalRuntime}:${path}`])), hash);
  assert.ok(oldFixture.includes(`"${path}": "${hash}"`));
}
const failed = JSON.parse(readFileSync(join(repository, base, 'migration/history/original-failed-hooks.json')));
const reportRoot = 'tests/integration/full-gate-20260827/combined-b494675c';
const capture = failed.originalCapture;
const compressed = git(['show', `${failed.reportCommit}:${reportRoot}/${capture.path}`]);
assert.equal(digest(compressed), capture.storedSha256);
const tap = capture.encoding === 'identity' ? compressed : gunzipSync(Buffer.from(compressed.toString().trim(), 'base64'));
assert.equal(digest(tap), capture.originalSha256);
const routing = JSON.parse(git(['show', `${failed.reportCommit}:${reportRoot}/FAILURE_ROUTING.json`]));
const rows = routing.failures.filter(row => row.file === fixture && row.group === 'historical-cleanup-pin');
assert.equal(rows.length, 10);
assert.deepEqual(failed.rows, rows);
for (const row of rows) {
  assert.equal(row.failureType, 'hookFailed');
  assert.ok(tap.toString().includes(row.detail));
}
save('semantic-comparison.json', {
  originalFixture: digest(oldFixture), currentFixture: files[fixture], byteIdenticalProbe: digest(oldProbe),
  originalOuterAssertions: assertionLines(oldFixture), currentOuterAssertions: assertionLines(newFixture),
  scenarioCount: 10, changedProbeAssertions: 0, authorSourceCanonicalProbeHelperIdentical: true,
  originalRuntime: historical.historicalRuntime, originalHarness: historical.historicalHarness,
  originalFailedHooks: rows.length, compressedCapture: capture, historicalReplayExecuted: false,
  meanings: ['normal and pipe exact status/stdout bytes/sink bytes/stderr', 'caller cancellation reason reference equality and empty sinks', 'same/other shell sibling signal and settlement isolation', 'actual native exit AND awaited termination at each public boundary', 'zero live workers and unhandled rejections'],
});
save('readonly-before.json', tree(join(repository, base, 'migration')));
save('tools-before.json', tree(join(repository, 'node_modules')));
save('initial.json', {
  time: new Date().toISOString(), candidate, candidateTree: expected.tree,
  sourceTree: git(['rev-parse', `${candidate}:src`]).toString().trim(),
  observedHeadAtFreeze: git(['rev-parse', 'HEAD']).toString().trim(),
  initialObservedHead: candidate, initialObservedIndex: 'empty',
  initialObservedStatus: ['?? benchmarks/reports/current-comparison-20260827/measurement-freeze/', '?? benchmarks/reports/current-comparison-20260827/measurement-review/', '?? tests/commands/diff-patch-stress/fuzz/.native-bvNFwI/', '?? tests/commands/search-stress/.native-1m4O1e/'],
  freezeStatus: git(['status', '--short']).toString(), stagedAtFreeze: git(['diff', '--cached', '--name-status']).toString(),
  node: process.version, platform: process.platform, arch: process.arch,
  executable: realpathSync(process.execPath), executableSha256: digest(readFileSync(process.execPath)),
  author, evidenceCommit: git(['rev-parse', '9167913d']).toString().trim(),
  expectedManifestSha256: digest(JSON.stringify(expected)), inputCensusSha256: digest(JSON.stringify(files)),
  freezeOnlyNoCandidateExecution: true,
});
console.log(JSON.stringify({ candidate, inputs: paths.length, originalFailuresPreserved: 10, freezeOnly: true }));
