import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const repo = '/Users/kjopek/Workspace/safe-bash';
const report = join(repo, 'benchmarks/reports/sort-performance-next-20260827');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(report, path));
const json = path => JSON.parse(read(path));
const inputs = json('inputs.json'), instrumentation = json('instrumentation.json');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
assert.equal(inputs.srcStatus, '');
assert.equal(git('rev-parse', `${inputs.selectedObservedCommittedSnapshot}^{tree}`).toString().trim(), inputs.sourceTree);
for (const [path, entry] of Object.entries(inputs.sourceFiles)) {
  const bytes = git('show', `${inputs.selectedObservedCommittedSnapshot}:${path}`);
  assert.equal(hash(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
}
for (const [path, entry] of Object.entries(inputs.evidenceFiles)) assert.equal(hash(git('show', `${entry.commit}:${path}`)), entry.sha256);
const old = 'benchmarks/reports/sort-performance-independent-20260827/evidence/';
const artifacts = JSON.parse(git('show', `${inputs.evidence}:${old}ARTIFACTS.json`));
for (const entry of artifacts) assert.equal(hash(git('show', `${inputs.evidence}:${old}${entry.path}`)), entry.sha256);
for (const path of ['src/commands/text.ts', 'src/commands/internal.ts']) {
  let original = git('show', `${inputs.selectedObservedCommittedSnapshot}:${path}`).toString();
  for (const edit of instrumentation.edits.filter(edit => edit.path === path)) { assert.equal(original.split(edit.before).length - 1, 1); original = original.replace(edit.before, edit.after); }
  const artifact = path.endsWith('text.ts') ? 'instrumented-text.ts.txt' : 'instrumented-internal.ts.txt';
  assert.equal(hash(original), hash(read(artifact))); assert.equal(hash(original), instrumentation.trees.instrumented[path]);
}
const require = createRequire(join(repo, 'package.json'));
assert.equal(hash(readFileSync(require.resolve('typescript'))), instrumentation.tools.typescriptSha256);
assert.equal(hash(readFileSync(process.execPath)), instrumentation.tools.nodeSha256);
const freeze = json('attempt-2/run-freeze.json');
assert.equal(hash(read('workloads.json')), freeze.activeWorkloadSha256);
assert.equal(hash(read('workloads.initial.json')), freeze.initialWorkloadSha256);
for (const [path, expected] of Object.entries(freeze.harnessHashes)) assert.equal(hash(read(path)), expected, path);
const initialFreeze = json('run-freeze.json');
for (const path of ['worker.mjs', 'run.mjs']) assert.equal(hash(read(path.replace('.mjs', '.initial.mjs.txt'))), initialFreeze.harnessHashes[path]);
const control = json('attempt-2/control.json'), instrumented = json('attempt-2/instrumented.json');
assert.equal(control.rows.length, 21); assert.equal(instrumented.rows.length, 21);
for (const result of [control, instrumented]) { assert.ok(result.rows.every(row => row.equivalent)); assert.equal(result.shellsDisposed, 21); }
assert.deepEqual(control.rows.map(row => row.observationHash), instrumented.rows.map(row => row.observationHash));
for (const id of ['numeric-stable-8000', 'numeric-key-8000']) {
  const profile = instrumented.rows.find(row => row.id === id).profile;
  assert.equal(profile.counts.numericParses, profile.counts.numericCompare * 2);
  assert.equal(profile.numericUseDistribution.records, 8000);
  assert.equal(profile.numericUseDistribution.sum, profile.counts.numericParses);
}
for (const path of ['cleanup.json', 'attempt-2/cleanup.json']) {
  const cleanup = json(path); assert.ok(cleanup.children.every(child => child.closed && !child.forced));
  assert.deepEqual(cleanup.remainingOwnedChildren, []); assert.equal(cleanup.beforeAfterTreesMatch, true); assert.equal(cleanup.scratchRemoved, true);
}
assert.equal(json('attempt-2/cleanup.json').successful, true);
assert.equal(existsSync(inputs.scratch), false);
assert.equal(existsSync('/tmp/sort-performance-next-independent-state.txt'), false);
const paths = readdirSync(report, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(report.length + 1)).filter(path => path !== 'MANIFEST.json').sort();
const manifest = { source: inputs.selectedObservedCommittedSnapshot, sourceTree: inputs.sourceTree, toolsRechecked: true, priorSealedEntriesRechecked: artifacts.length, control: '21/21', instrumented: '21/21', files: Object.fromEntries(paths.map(path => [path, { sha256: hash(read(path)), bytes: read(path).length }])) };
if (process.argv.includes('--capture')) writeFileSync(join(report, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
else assert.deepEqual(manifest, json('MANIFEST.json'));
console.log(JSON.stringify({ files: paths.length, source: inputs.selectedObservedCommittedSnapshot, sealed: true, mode: process.argv.includes('--capture') ? 'capture' : 'read-only check' }));
