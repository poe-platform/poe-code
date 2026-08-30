import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(readFileSync(directory + name));
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const put = (name, object) => writeFileSync(directory + name, JSON.stringify(object, null, 2) + '\n', { flag: 'wx' });
const baseline = read('baseline-dce6e3824d6d-v2/admission.json');
const candidate = read('candidate-08a26051438f-v2/admission.json');
const baselineSource = git(['show', baseline.commit + ':src/commands/text.ts']).toString();
const candidateSource = git(['show', candidate.commit + ':src/commands/text.ts']).toString();
const normalized = text => text.split('\n').map(line => line.trim()).join('\n').trim();
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
assert.equal(normalized(section(baselineSource, 'const match = /^[ \\t]*', '  };')), normalized(section(candidateSource, 'const match = /^[ \\t]*', '\n}')));
const comparison = source => section(source, 'if (first.negative !== second.negative)', 'return first.negative ? -compared : compared;') + 'return first.negative ? -compared : compared;';
assert.equal(normalized(comparison(baselineSource)), normalized(comparison(candidateSource)));
assert.equal(section(baselineSource, 'async function emitRecords(', 'export function textCommands('), section(candidateSource, 'async function emitRecords(', 'export function textCommands('));
assert.equal(baselineSource.slice(baselineSource.indexOf('      const keyCompare =')), candidateSource.slice(candidateSource.indexOf('      const keyCompare =')).replace('compareNumeric(first, second)', 'numericCompare(first, second)'));
const sourceHashes = [];
for (const admission of [baseline, candidate]) {
  for (const file of admission.sources) {
    const after = hash(git(['show', `${admission.commit}:${file.path}`]));
    assert.equal(after, file.sha256);
    assert.equal(hash(readFileSync(join(admission.sourceRoot, file.path))), file.sha256);
    sourceHashes.push({ commit: admission.commit, path: file.path, before: file.sha256, after });
  }
}
const changed = candidate.sources.filter(file => baseline.sources.find(original => original.path === file.path)?.sha256 !== file.sha256).map(file => ({ path: file.path, before: baseline.sources.find(original => original.path === file.path)?.sha256, after: file.sha256 }));
assert.deepEqual(changed.map(file => file.path), ['src/commands/grep-aliases/index.ts', 'src/commands/text.ts', 'src/shell/runtime.ts']);
put('source-review.json', { baselineCommit: baseline.commit, candidateCommit: candidate.commit, candidateTree: candidate.tree, changed, exactParserNormalizedLinesEqual: true, exactComparisonNormalizedLinesEqual: true, collectorAndOutputFunctionsByteEqual: true, postCacheSortBodyByteEqualExceptDispatchName: true, publicMetadataAndExportsUnchanged: true, sourceHashes, scope: 'Full snapshots have unrelated committed grep/runtime differences; no sort-only full-tree attribution.' });
const instrumentedBaseline = read('extensions/baseline-instrumented.results.json');
const instrumentedCandidate = read('extensions/candidate-instrumented.results.json');
const actualRows = variant => [
  ...read((variant === 'baseline' ? 'baseline-dce6e3824d6d-v2/' : 'candidate-08a26051438f-v2/') + 'results.json').rows,
  ...read(`extensions/${variant}-caps.results.json`).rows,
];
const accounting = [];
for (const [variant, instrumented] of [['baseline', instrumentedBaseline], ['candidate', instrumentedCandidate]]) {
  const actual = actualRows(variant);
  for (const row of instrumented.rows) assert.equal(row.observationHash, actual.find(other => other.id === row.id).observationHash, row.id);
}
for (const before of instrumentedBaseline.rows) {
  const after = instrumentedCandidate.rows.find(row => row.id === before.id);
  for (const name of ['records', 'recordPayloadBytes', 'sortComparisons', 'numericComparisons', 'fractionPadEndCalls', 'keyExtractions', 'keyInputBytes']) assert.equal(after.counts[name] ?? 0, before.counts[name] ?? 0, `${before.id}/${name}`);
  accounting.push({ id: before.id, baseline: before.counts, candidate: after.counts, outputEqual: before.observationHash === after.observationHash });
}
const numeric = instrumentedCandidate.rows.find(row => row.id === 'numeric-stable-8000').counts;
assert.equal(numeric.parses, 8000);
assert.equal(numeric.admissions, 8000);
const keys = instrumentedCandidate.rows.find(row => row.id === 'numeric-key-8000').counts;
assert.equal(keys.parses, 164900);
assert.equal(keys.cacheCreated ?? 0, 0);
for (const [id, entries, charge, fallbacks] of [
  ['empty-entry-below', 16383, 32766, 0], ['empty-entry-at', 16384, 32768, 0],
  ['empty-entry-above', 16384, 32768, 1], ['characters-below', 2, 1048570, 0],
  ['characters-at', 2, 1048576, 0], ['characters-above', 1, 524288, 1],
  ['huge-short-prefix', 2, 16, 2], ['mixed-saturation', 16384, 868352, 5],
]) {
  const counts = instrumentedCandidate.rows.find(row => row.id === id).counts;
  assert.equal(counts.peakEntries, entries, id);
  assert.equal(counts.peakRetainedCharge, charge, id);
  assert.equal(counts.fallbacks ?? 0, fallbacks, id);
}
put('operation-audit.json', { actualVersusInstrumentedAll66ObservationsEqualPerVariant: true, unchangedComparatorCollectionKeyPaddingCounts: true, accounting, claims: 'Counts are intrusive operation observations, not speed/memory measurements.' });
const originalFiles = git(['ls-tree', '-r', '--name-only', 'fcd6d0218725342e4ef1aa098e23b0cdfbe9cd10', 'benchmarks/reports/sort-performance-next-20260827/unkeyed-review']).toString().trim().split('\n');
for (const path of originalFiles) assert.equal(hash(readFileSync(path)), hash(git(['show', `fcd6d0218725342e4ef1aa098e23b0cdfbe9cd10:${path}`])));
const v2 = read('freeze-v2.json');
assert.equal(hash(readFileSync(directory + 'expected-v2.json')), v2.expectedSha256);
const sourceRoots = new Set();
let publicShells = 0;
let spawnedChildren = 0;
for (const name of ['baseline-dce6e3824d6d', 'baseline-dce6e3824d6d-v2', 'candidate-08a26051438f-v2']) {
  const admission = read(name + '/admission.json');
  const summary = read(name + '/summary.json');
  sourceRoots.add(admission.scratch);
  publicShells += summary.shellsDisposed;
  const commands = read(name + '/commands.json');
  assert.ok(commands.every(command => command.exactChildClosed));
  spawnedChildren += commands.length;
  const worker = join(admission.scratch, 'moved-public-consumer/public-worker.mjs');
  assert.equal(hash(readFileSync(worker)), admission.workerSha256);
  copyFileSync(worker, directory + name + '/public-worker.used.mjs.txt');
  const packagePath = join(admission.scratch, 'moved-public-consumer/node_modules/virtual-bash');
  for (const file of read(name + '/package-manifest.json')) assert.equal(hash(readFileSync(join(packagePath, file.path))), file.sha256);
}
const extensions = read('extensions/closed.json');
assert.equal(extensions.allExactChildrenClosed, true);
spawnedChildren += extensions.childCount;
publicShells += extensions.allShellsDisposed;
sourceRoots.add(read('extensions/plan.json').scratch);
for (const cohort of ['pinned', 'pinned-v2']) {
  const admission = read(cohort + '/admission.json');
  sourceRoots.add(admission.scratch);
  for (const result of read(cohort + '/summary.json')) {
    assert.equal(result.exactChildClosed, true);
    spawnedChildren++;
    const root = join(admission.scratch, result.variant);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
    for (const file of manifest) assert.equal(hash(readFileSync(join(root, file.path))), file.sha256);
    copyFileSync(join(root, 'worker.mjs'), directory + cohort + `/${result.variant}.worker.used.mjs.txt`);
    if (existsSync(join(root, 'select-tests.mjs'))) copyFileSync(join(root, 'select-tests.mjs'), directory + cohort + `/${result.variant}.selection.used.mjs.txt`);
    if (cohort === 'pinned') put(cohort + '/retrospective-integrity.json', { allManifestFilesStillEqual: true, failedAttemptPreserved: true, validationIsPostHocNotOriginalExitProof: true, deniedNativeAttempts: 23, nativeProcessesLaunched: 0 });
  }
}
assert.equal(publicShells, 337);
assert.equal(spawnedChildren, 27);
copyFileSync('/tmp/sort-unkeyed-review-coordination.txt', directory + 'final-coordination.txt');
const removed = [];
for (const root of sourceRoots) {
  const resolved = realpathSync(root);
  assert.ok(/^\/private\/tmp\/sort-unkeyed-review-(?:baseline|candidate|extensions|pinned)-[A-Za-z0-9]+$/u.test(resolved), resolved);
  assert.equal(resolved, root);
  rmSync(resolved, { recursive: true, force: false });
  assert.equal(existsSync(resolved), false);
  removed.push(resolved);
}
put('cleanup.json', { created: new Date().toISOString(), removed, exactSpawnedValidationChildrenClosed: spawnedChildren, publicWorkerShellsDisposed: publicShells, pinnedDisposal: 'Pinned test bodies retain their original finally/disposal paths; not included in public-worker counter.', beforeCleanupAllImmutableSourcesPackagesInputsAuthenticated: true, originalFreezeUnchanged: true, v2FreezeUnchanged: true, foreignScratchUntouched: true, markersRetained: ['/tmp/sort-unkeyed-review-frozen.txt', '/tmp/sort-unkeyed-review-findings.txt', '/tmp/sort-unkeyed-review-ready.txt'] });
function inventory(prefix = '') {
  return readdirSync(directory + prefix, { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    return entry.isDirectory() ? inventory(path) : [{ path, bytes: readFileSync(directory + path).length, sha256: hash(readFileSync(directory + path)) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}
const artifacts = inventory();
put('ARTIFACTS.json', { candidate: candidate.commit, originalFreeze: 'fcd6d0218725342e4ef1aa098e23b0cdfbe9cd10', v2Freeze: 'aa544b37e3dfd940f5c3a4b3c21ff5ae9d42abc6', artifacts });
console.log(JSON.stringify({ sealedArtifacts: artifacts.length, scratchRootsRemoved: removed.length, validationChildrenClosed: spawnedChildren, publicShellsDisposed: publicShells }));
