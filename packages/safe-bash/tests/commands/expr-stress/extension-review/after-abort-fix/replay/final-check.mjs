import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addEvidence, owned, root, git, json, sha256, verifyFrozen, cohorts } from './review.mjs';

function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `unexpected link ${path}`);
    return stat.isDirectory() ? inventory(path, relative) : [{ path: relative, sha256: sha256(readFileSync(path)) }];
  });
}
if (process.argv[2] !== 'capture-and-cleanup') { verifyFrozen(); console.log('Read-only frozen verification. Explicit capture-and-cleanup required for staged archive check/removal.'); process.exit(0); }
const before = JSON.parse(readFileSync(`${owned}/integrity-before.json`));
const after = { at: new Date().toISOString(), stages: [], freezes: verifyFrozen(), readonly: [], nativePins: [], harnessBindings: [], cleanup: [] };
assert.deepEqual(after.freezes, before.freezes);
const bindings = JSON.parse(readFileSync(`${owned}/harness-bindings.json`));
for (const entry of bindings.bindings) {
  assert.equal(sha256(git('show', entry.origin)), entry.originalSha256);
  assert.equal(sha256(readFileSync(`${owned}/${entry.file}`)), entry.boundSha256);
  after.harnessBindings.push({ file: entry.file, originalSha256: entry.originalSha256, boundSha256: entry.boundSha256 });
}
for (const label of ['candidate-27a77935', 'baseline-8f19a9d5']) {
  const stage = JSON.parse(readFileSync(`${owned}/${label}/stage.json`));
  const source = inventory(join(stage.source, 'src')), installed = inventory(stage.installed);
  assert.deepEqual(source, stage.sourceFiles);
  assert.deepEqual(installed, stage.installedFiles);
  assert.equal(sha256(readFileSync(join(stage.sourceRoot, 'candidate.tar'))), stage.archiveSha256);
  assert.equal(sha256(readFileSync(join(stage.sourceRoot, stage.pack.filename))), stage.packageSha256);
  for (const input of stage.buildInputs) assert.equal(sha256(readFileSync(join(stage.source, input.path))), input.sha256);
  for (const input of stage.devtools) assert.equal(sha256(readFileSync(join(root, 'node_modules', input.path))), input.sha256);
  for (const input of source) assert.equal(sha256(git('show', `${stage.commit}:src/${input.path}`)), input.sha256);
  if (label === 'candidate-27a77935') { assert.deepEqual(source, before.source); assert.deepEqual(installed, before.installed); }
  after.stages.push({ label, commit: stage.commit, sourceTreeGitId: stage.sourceTreeGitId, sourceInventory: source, sourceInventorySha256: sha256(json(source)), installedInventory: installed, installedInventorySha256: sha256(json(installed)), archiveSha256: stage.archiveSha256, packageSha256: stage.packageSha256, completeSrcAndInstalledInventoriesIncludingAdditionsChecked: true, entireArchivedTestTreeAppendProof: false });
}
const fixed = JSON.parse(readFileSync(`${owned}/candidate-27a77935/stage.json`));
const tested = JSON.parse(readFileSync(`${owned}/archived-regression-inputs.json`));
after.archivedRegressionInputs = [...tested.identities, ...tested.additional, { path: 'tests/commands/grep-aliases/native.test.ts' }].map(input => {
  const hash = sha256(readFileSync(join(fixed.source, input.path)));
  if (input.sha256) assert.equal(hash, input.sha256);
  assert.equal(hash, sha256(git('show', `${fixed.commit}:${input.path}`)));
  return { path: input.path, sha256: hash };
});
for (const [commit, base, complete] of [
  ['f6e0533920d9583af80f044a327bfcaa381d7cac', 'tests/commands/expr-stress/extension-review/execution', true],
  ['f5a60d3fa1947dcd6086bc503a32c8faaab2ce7a', 'tests/commands/expr-stress/extension-review/after-abort-fix', false],
  ['7f22cb8c13d5520f870585ab0d1b476083a213bc', 'tests/commands/expr-stress/nullable-capture-review', true],
]) {
  const paths = git('ls-tree', '-r', '--name-only', commit, '--', base).toString().trim().split('\n');
  if (complete) assert.deepEqual(inventory(base).map(item => `${base}/${item.path}`).sort(), paths.sort());
  const files = paths.map(path => { const hash = sha256(readFileSync(path)); assert.equal(hash, sha256(git('show', `${commit}:${path}`))); return { path, sha256: hash }; });
  after.readonly.push({ commit, base, files, additionsChecked: complete, note: complete ? 'Complete old subtree unchanged' : 'Five preparation files unchanged; new owned replay subtree intentionally excluded from historical inventory.' });
}
for (const [name, identity] of Object.entries(cohorts()[0].receipt.identities)) {
  assert.equal(sha256(readFileSync(identity.actualPath)), identity.sha256);
  after.nativePins.push({ name, path: identity.actualPath, sha256: identity.sha256 });
}
const du = fixed.sourceFiles.filter(item => item.path.startsWith('commands/du/'));
assert.equal(du.length, 7);
for (const file of du) assert.equal(file.sha256, sha256(git('show', `877144ea:src/${file.path}`)));
after.wholeSourceDelta = { modified: ['src/commands/regex-execution/client.ts'], added: du.map(item => ({ path: `src/${item.path}`, sha256: item.sha256, origin: '877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3' })) };
const measured = [];
for (const capture of ['controls-27a77935/controls.json', 'supplement-27a77935/controls.json', 'remaining-first/controls.json', 'independent-first/controls.json']) {
  const report = JSON.parse(readFileSync(`${owned}/${capture}`));
  for (const row of report.rows) {
    assert(row.passed);
    const outer = row.outer ?? row;
    assert.equal(outer.state, 'returned'); assert.equal(outer.terminationAwaited, true);
    const value = row.outer ? row.outer.value?.value : row.value;
    for (const field of ['activeBeforeSafetyCleanup', 'liveWorkers', 'activeAtRejection']) if (typeof value?.[field] === 'number') { assert.equal(value[field], 0); measured.push({ capture, id: row.id, field, value: value[field] }); }
  }
}
after.cleanupMeasurements = measured;
after.workerScope = 'Every contained job returned and outer termination was awaited; listed actual pre-safety and deterministic synthetic counters are zero. Extra-driver sessions await product close/dispose; malformed-worker exchange awaits termination. No opaque host-promise universal drain claim.';
after.inventoryNegativeControls = ['missing', 'changed', 'added'].map(kind => {
  const expected = before.source, modified = structuredClone(expected);
  if (kind === 'missing') modified.pop();
  if (kind === 'changed') modified[0].sha256 = '0'.repeat(64);
  if (kind === 'added') modified.push({ path: 'new-unexpected-entry', sha256: '0'.repeat(64) });
  assert.throws(() => assert.deepEqual(modified, expected));
  return { kind, rejected: true, sourceWasNotMutated: true };
});
for (const label of ['candidate-27a77935', 'baseline-8f19a9d5']) {
  const stage = JSON.parse(readFileSync(`${owned}/${label}/stage.json`));
  for (const path of [stage.sourceRoot, stage.destinationRoot]) {
    assert(path.includes('/T/expr-final-archive-') || path.includes('/T/expr-final-moved-'));
    assert.notEqual(path, root);
    rmSync(path, { recursive: true });
    assert(!existsSync(path));
    after.cleanup.push({ path, removed: true, owner: label });
  }
}
after.completedAt = new Date().toISOString();
addEvidence(`${owned}/final-integrity.json`, after);
console.log(JSON.stringify({ stages: after.stages.map(stage => ({ label: stage.label, source: stage.sourceInventory.length, installed: stage.installedInventory.length })), readonly: after.readonly.map(item => ({ base: item.base, count: item.files.length })), cleanupCounters: measured.length, cleanedRoots: after.cleanup.length }));
