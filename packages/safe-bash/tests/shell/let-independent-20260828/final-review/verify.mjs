import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, hash, json, packInventory, save } from '../execution-prep-v1/artifacts.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), owned = dirname(scope), repository = resolve(owned, '../../..');
const original = json(join(owned, 'actual-frozen-02/REPORT.json')), amended = json(join(owned, 'actual-amendments-01/REPORT.json')), regressions = json(join(owned, 'regression-results-original-01/REPORT.json')), settlement = json(join(owned, 'settlement-results-actual-package-02/REPORT.json'));
const seals = {
  '': '7a4ccb782cfbeca21ca710aa6f8f8839e491dc41',
  'execution-prep-v1/': '7a4ccb782cfbeca21ca710aa6f8f8839e491dc41',
  'candidate-review-v1/': '4b94b827fce7d7efc62a4ce52c5a69c1e4cae46a',
  'candidate-review-v2/': 'd9a2e597184c3ce076a7b74c1d0a21098b06805b',
  'regressions-v1/': 'abfeffb5b826c3d54345a103cb52f058298f2739',
  'amendments-v1/': '913da9ed20e6927c6880d077cb1b1f12b9d4d059',
  'settlement-v1/': 'dab350a56eb6804a4b6aa27bf5c8cc872e686748',
  'settlement-v2/': 'd3c1bb62304809cac149a61fc2f1cebe46d076ff',
};
let sealedFiles = 0;
for (const [prefix, revision] of Object.entries(seals)) {
  const seal = readFileSync(join(owned, prefix, 'SEAL.json'));
  assert.deepEqual(seal, git(repository, ['show', `${revision}:tests/shell/let-independent-20260828/${prefix}SEAL.json`]));
  for (const [name, digest] of Object.entries(JSON.parse(seal))) {
    assert.equal(hash(readFileSync(join(owned, prefix, name))), digest);
    assert.equal(hash(git(repository, ['show', `${revision}:tests/shell/let-independent-20260828/${prefix}${name}`])), digest);
    sealedFiles++;
  }
}
assert.equal(original.completed, true); assert.equal(original.accepted, false);
const cohorts = {};
for (const layout of ['source', 'moved']) {
  const rows = original.behavior.filter(row => row.name === `${layout}-literal` || new RegExp(`^${layout}-S\\d\\d$`, 'u').test(row.name));
  assert.equal(rows.length, 27); assert.ok(rows.every(row => row.coherent));
  const count = rows.reduce((sum, row) => sum + row.expected, 0), pass = rows.reduce((sum, row) => sum + row.passed, 0), failed = rows.flatMap(row => row.failed);
  assert.equal(count, 84); assert.equal(pass, 81); assert.deepEqual(failed, ['P39', 'P58', 'S26']);
  const supplement = amended.behavior.find(row => row.name === `${layout}-amendments`);
  assert.equal(supplement.accepted, true); assert.equal(supplement.passed, 3);
  cohorts[layout] = { original: { count, pass, failed }, qualifiedSupportedProfile: { carriedUnchangedPasses: 81, versionedSupplementPasses: 3, total: 84, nounsetSupported: false } };
}
const families = new Set([...json(join(owned, 'cases.json')), ...json(join(owned, 'synthetic.json'))].map(row => row.family)); assert.equal(families.size, 22);
assert.equal(amended.completed, true); assert.equal(amended.accepted, true); assert.equal(amended.originalCohortAccepted, false);
assert.ok(amended.behavior.every(row => row.accepted)); assert.equal(amended.behavior.find(row => row.name === 'installed-amendments').passed, 3);
assert.equal(original.guards.length, 7); assert.ok(original.guards.every(row => row.denied));
assert.equal(original.mutants.length, 7); assert.equal(original.mutants.filter(row => row.killed).length, 6);
assert.equal(original.mutants.find(row => row.id === 'M3').killed, false);
assert.equal(amended.mutants.length, 1); assert.equal(amended.mutants[0].mutantKilled, true); assert.equal(amended.mutants[0].observations[0].result.stdout, '1:0:0\n');
assert.ok(amended.mutants[0].activations.some(row => row.id === 'M3-v2' && row.hits > 0));
assert.equal(regressions.completed, true); assert.equal(regressions.pass, 167);
const typeResults = {};
for (const layout of ['installed', 'moved']) {
  const names = [['types-consumer', 0], ['types-negative-limit', 2], ['types-negative-limit-neutralized', 0], ['types-v2-exact-api', 2], ['types-v2-exact-api-neutralized', 0]];
  for (const [name, code] of names) {
    const phase = original.phases.find(row => row.name === `${layout}-${name}`); assert.ok(phase);
    const run = json(join(owned, 'actual-frozen-02', phase.file)); assert.equal(run.code, code);
    if (name === 'types-v2-exact-api') assert.equal(run.stdout, `negative-api.mts(1,10): error TS2724: '"virtual-bash"' has no exported member named 'createLetCommands'. Did you mean 'createFileCommands'?\n`);
  }
  assert.ok(original.typeFailures.some(row => row.label === layout)); typeResults[layout] = { qualifiedChecks: 5, pass: 5, originalTS2305MatcherStillFails: true };
}
const runtime = git(repository, ['show', 'c26892c3a1a419311c9cf46a6c2976e696e00624:src/shell/runtime.ts']);
assert.equal(hash(runtime), 'eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193');
assert.equal(amended.strippedExactlyAcceptedCD.sha256, '93c06908aec9d5d61d801657f99ab75122cadb6688f038e1941c587b4a8d4ed3');
const bindings = json(join(owned, 'BINDINGS.json')); assert.equal(bindings.source.length, 265);
for (const entry of bindings.source) assert.equal(hash(git(repository, ['show', `${entry.revision}:${entry.path}`])), entry.sha256);
const packageHashes = [];
for (const directory of ['actual-frozen-01', 'actual-frozen-02', 'actual-amendments-01']) {
  const pack = readFileSync(join(owned, directory, 'virtual-bash-0.0.0.tgz')), members = packInventory(pack);
  assert.equal(Object.keys(members).length, 846); assert.equal(hash(pack), '21c4858e6e4b857cd5e0d526159667621bcd206b4f1fd1ce1f84b54ad7abbace');
  assert.deepEqual(members, original.candidateEmitted); packageHashes.push({ directory, sha256: hash(pack), members: 846 });
}
assert.deepEqual(amended.candidateEmitted, original.candidateEmitted);
assert.equal(settlement.completed, true); assert.equal(settlement.runs.length, 2);
assert.equal(settlement.runs[0].result.accepted, true); assert.equal(settlement.runs[1].result.passed, 1); assert.equal(settlement.runs[1].result.accepted, false);
assert.deepEqual(settlement.runs[1].result.errors, ['exit status contradicts body outcomes']);
let supervisedChildren = 0;
for (const directory of ['actual-frozen-01', 'actual-frozen-02', 'actual-amendments-01']) {
  const report = json(join(owned, directory, 'REPORT.json')); assert.equal(report.scratchRemoved, true);
  for (const phase of report.phases) {
    const path = join(owned, directory, phase.file); assert.equal(hash(readFileSync(path)), phase.sha256);
    const run = json(path); assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true); assert.equal(run.failure, null); assert.equal(run.signal, null); assert.equal(run.spawnError, null);
    if (run.cwd?.includes('/let-independent-')) assert.equal(existsSync(run.cwd), false);
    supervisedChildren++;
  }
}
const regressionRaw = json(join(owned, 'regression-results-original-01/raw.json')); assert.equal(regressionRaw.groupAbsent, true); assert.equal(existsSync(regressionRaw.cwd), false); supervisedChildren++;
for (const [directory, files] of [['settlement-results-actual-package-01', ['normal.json']], ['settlement-results-actual-package-02', ['normal.json', 'late-exit.json']]]) {
  assert.equal(json(join(owned, directory, 'REPORT.json')).scratchRemoved, true);
  for (const file of files) { const { run } = json(join(owned, directory, file)); assert.equal(run.groupAbsent, true); assert.equal(run.closeObserved, true); assert.equal(existsSync(run.cwd), false); supervisedChildren++; }
}
const result = { verdict: 'bounded independent supported-profile acceptance; original failures retained', candidate: 'c26892c3a1a419311c9cf46a6c2976e696e00624', runtimeSha256: hash(runtime), selectedInputs: 265, fullPackMembers: 846, packageHashes, sealedFiles, cohorts, families: families.size, installedSupplement: { pass: 3, total: 3 }, typeResults, strictProductionBuild: true, regressions: { pass: 167, total: 167, skipped: 0 }, admissionNegatives: 7, originalMutants: { killed: 6, total: 7, survivor: 'ineffective M3' }, qualifiedMutantGroups: { killed: 7, total: 7, replacement: 'actual M3-v2 with unchanged P21' }, actualPackageSettlementControls: 2, supervisedChildren, ownedScratchRemoved: true, productEdits: 0, nativeReruns: 0, wholeGate: false, sourceCompleteness: '265 selected committed inputs, not full Git archive', sourceBase: amended.strippedExactlyAcceptedCD };
if (process.argv[2]) save(process.argv[2], result);
process.stdout.write(JSON.stringify(result) + '\n');
