import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const candidate = '67eab12e315054907ef4ef435c6bbca2f59e0c36';
const prior = '17735a5eabf65a6398a64aef81e67fee2405733e';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
assert.equal(realpathSync(process.execPath), '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node');
assert.equal(process.version, 'v22.22.2');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (name) => JSON.parse(readFileSync(resolve(directory, name)));
const gitRead = (args) => execFileSync(git, args, {
  cwd: repository,
  timeout: 10000,
  maxBuffer: 2 * 1024 * 1024,
});
const manifest = read('MANIFEST.json');
const bindings = read('BINDINGS.json');
const eligibility = read('ELIGIBILITY.json');
const legacy = read('LEGACY-RECIPES.json');
const workflows = read('WORKFLOWS.json');
const controls = read('CONTROLS.json');
const readiness = read('READINESS.json');
assert.deepEqual(readdirSync(directory).sort(), [...manifest.files.map((entry) => entry.path), 'MANIFEST.json'].sort());
assert.equal(new Set(manifest.files.map((entry) => entry.path)).size, manifest.files.length);
for (const entry of manifest.files) {
  assert.equal(basename(entry.path), entry.path);
  assert(!entry.path.toLowerCase().includes('agents'));
  const filename = resolve(directory, entry.path);
  const stat = lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, entry.mode);
  const bytes = readFileSync(filename);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
}
assert.equal(bindings.target.commit, candidate);
assert.equal(bindings.target.packSha256, '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06');
assert.equal(bindings.target.defaultNames.length, 78);
assert.equal(new Set(bindings.target.defaultNames).size, 78);
assert(!bindings.target.defaultNames.includes('curl'));
assert(!bindings.target.defaultNames.includes('safejs'));
assert(!bindings.target.defaultNames.includes('getopts'));
assert.equal(bindings.comparator.version, '3.4.2');
assert.equal(bindings.comparator.latestClaim, false);
assert.deepEqual(bindings.history.targetOperational, [13, 54]);
assert.deepEqual(bindings.history.baselineOperational, [47, 54]);
assert.equal(bindings.history.baselineRawPredicateMatches, 50);
assert.equal(bindings.history.unionScore, null);
assert.equal(bindings.history.rawArchiveReopened, false);
assert(Object.values(bindings.executionCounts).every((value) => value === 0));
for (const tool of bindings.tools) {
  const stat = lstatSync(tool.path);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(sha256(readFileSync(tool.path)), tool.sha256, tool.path);
}
assert.equal(bindings.tools.find((tool) => tool.path === git)?.sha256, '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
const authenticated = new Map();
for (const entry of bindings.inputBindings) {
  assert([candidate, prior].includes(entry.commit));
  assert(!entry.path.split('/').some((component) => component === '..' || component === 'AGENTS.md'));
  assert(!entry.path.startsWith('/'));
  assert.equal(entry.mode, '100644');
  const tree = gitRead(['ls-tree', entry.commit, '--', entry.path]).toString();
  assert.equal(tree.split(' ')[0], entry.mode);
  const bytes = gitRead(['show', `${entry.commit}:${entry.path}`]);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
  authenticated.set(`${entry.commit}:${entry.path}`, bytes);
}
const originalBytes = authenticated.get(`${prior}:tests/comparison/next-gap-inventory-20260828/BREADTH.json`);
assert(originalBytes);
const original = JSON.parse(originalBytes);
assert.equal(eligibility.rows.length, 54);
assert.deepEqual(eligibility.rows.map((row) => row.id), original.rows.map((row) => row.id));
assert.equal(eligibility.selected, 23);
assert.equal(eligibility.unselected, 31);
assert.equal(legacy.count, 23);
assert.equal(legacy.rows.length, 23);
const selectedIds = eligibility.rows.filter((row) => row.eligibility.startsWith('eligible-')).map((row) => row.id);
assert.deepEqual(legacy.rows.map((row) => row.id), selectedIds);
const actualCategories = {};
for (const row of eligibility.rows) {
  const old = original.rows.find((item) => item.id === row.id);
  assert.equal(row.recipeHash, old.recipeHash);
  assert.equal(row.historicalTargetOperational, old.historical.ours.operationalCredit);
  assert.equal(row.historicalComparatorOperational, old.historical.baseline.operationalCredit);
  actualCategories[row.eligibility] = (actualCategories[row.eligibility] ?? 0) + 1;
}
assert.deepEqual(actualCategories, eligibility.counts);
for (const row of legacy.rows) {
  const old = original.rows.find((item) => item.id === row.id);
  assert.deepEqual(row.recipe, old.recipe, row.id);
  assert.equal(sha256(JSON.stringify(row.recipe)), row.recipeHash);
  assert.equal(row.recipe.budgetMs, 30000);
}
assert.equal(workflows.count, 10);
assert.equal(workflows.rows.length, 10);
assert.equal(new Set(workflows.rows.map((row) => row.id)).size, 10);
assert.equal(controls.count, 12);
assert.equal(controls.rows.length, 12);
assert(controls.rows.every((row) => row.executions === 0 && row.productChildCeiling === 2));
assert.equal(readiness.gates.length, 3);
assert.deepEqual(readiness.gates.flatMap((gate) => gate.oldCaseIds).sort(), ['dirs-positive', 'popd-positive', 'pushd-positive', 'shopt-positive', 'yq-positive']);
for (const gate of readiness.gates) {
  assert.equal(gate.executions, 0);
  for (const row of gate.originalRecipes) {
    assert(!selectedIds.includes(row.id));
    assert.deepEqual(row.recipe, original.rows.find((item) => item.id === row.id).recipe);
    assert.equal(sha256(JSON.stringify(row.recipe)), row.recipeHash);
  }
}
const validBase64 = (value) => {
  assert.equal(typeof value, 'string');
  assert.equal(Buffer.from(value, 'base64').toString('base64'), value);
  return Buffer.from(value, 'base64');
};
for (const row of workflows.rows) {
  assert.equal(row.classification, 'new-additive-unexecuted');
  assert.equal(row.cwd, '/fixture');
  assert(Buffer.byteLength(row.script) <= 8192);
  assert.equal(row.expected.exitCode, 0);
  assert.equal(row.expected.stderrBase64, '');
  assert(row.expected.preserveInitialBytesAndPermissionBits && row.expected.exactFinalNamespace);
  assert.equal(row.expected.compareNewFileModes, false);
  assert.equal(Object.keys(row.symlinks).length, 0);
  let inputBytes = validBase64(row.stdinBase64).length;
  for (const [name, file] of Object.entries(row.files)) {
    assert(!name.startsWith('/') && !name.split('/').includes('..'));
    inputBytes += validBase64(file.base64).length;
    assert([420, 493].includes(file.mode));
  }
  assert(inputBytes <= 65536);
  assert(Object.keys(row.files).length + row.directories.length <= 32);
  assert(validBase64(row.expected.stdoutBase64).length <= 65536);
  let addedBytes = 0;
  for (const file of Object.values(row.expected.addedFiles)) addedBytes += validBase64(file.base64).length;
  assert(addedBytes + inputBytes <= 65536);
}
const binaryRow = workflows.rows.find((row) => row.id === 'W03');
assert.equal(binaryRow.stdinBase64, 'AP9BCg2AAA==');
assert.equal(binaryRow.expected.stdoutBase64, binaryRow.stdinBase64);
assert.equal(binaryRow.expected.addedFiles.copied.base64, binaryRow.stdinBase64);
assert.equal(binaryRow.inputChunkLengths.reduce((sum, length) => sum + length, 0), 7);
const checksumRow = workflows.rows.find((row) => row.id === 'W08');
assert.equal(checksumRow.oracleProvenance.digest, sha256('abc\n'));
assert.equal(Buffer.from(checksumRow.expected.addedFiles.sums.base64, 'base64').toString(), `${sha256('abc\n')}  payload\n`);
const validation = read('VALIDATION.json');
assert.equal(validation.kind, 'static-data-validation-only');
assert.equal(validation.semanticExecutions, 0);
assert.equal(bindings.engineMetric.engineRuns, 24);
assert.equal(bindings.engineMetric.distinctGuestPrograms, 7);
assert.equal(bindings.engineMetric.successfulEngineReturns, 12);
assert.equal(bindings.engineContinuationGuestEvaluations, 0);
console.log(JSON.stringify({
  status: 'PREPARATION_DATA_VALID',
  authenticatedInputs: bindings.inputBindings.length,
  eligibilityRows: eligibility.rows.length,
  unchangedSelectedRecipes: legacy.rows.length,
  proposedWorkflows: workflows.rows.length,
  proposedControls: controls.rows.length,
  futureReadinessGates: readiness.gates.length,
  semanticExecutions: 0,
  admission: 'Different reviewer and concrete executor/tool/adapter seal still required',
}));
