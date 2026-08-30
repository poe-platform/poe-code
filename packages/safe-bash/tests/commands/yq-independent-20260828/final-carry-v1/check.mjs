import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';

const repository = '/Users/kjopek/Workspace/safe-bash';
const prefix = 'tests/commands/yq-independent-20260828';
const directory = `${prefix}/final-carry-v1`;
assert.equal(process.cwd(), repository);
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 1048576 });
const read = path => readFileSync(`${repository}/${path}`);
const json = path => JSON.parse(read(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalManifest = read(`${directory}/MANIFEST.json`);
const manifest = JSON.parse(originalManifest);
const identities = json(`${directory}/SOURCES.json`);
const traces = json(`${directory}/RESOURCE-TRACES.json`);
const sourceBytes = new Map();

function mode(path) {
  const metadata = lstatSync(`${repository}/${path}`);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), path);
  return metadata.mode & 0o111 ? '100755' : '100644';
}

function treeRows(revision, path) {
  return git('ls-tree', '-r', '-t', revision, '--', path).toString().trim().split('\n').map(line => {
    const [metadata, filename] = line.split('\t');
    const [entryMode, type, blob] = metadata.split(' ');
    return { path: filename, mode: entryMode, type, blob };
  }).filter(row => row.path.startsWith(`${path}/`));
}

function liveEntries(path) {
  return readdirSync(`${repository}/${path}`, { withFileTypes: true }).flatMap(entry => {
    const filename = `${path}/${entry.name}`;
    assert(!entry.isSymbolicLink(), filename);
    if (entry.isDirectory()) return [{ path: filename, mode: '040000', type: 'tree' }, ...liveEntries(filename)];
    return [{ path: filename, mode: mode(filename), type: 'blob' }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function verifyHistory() {
  let files = 0;
  for (const scope of identities.protectedScopes) {
    assert.equal(git('rev-parse', `${scope.revision}:${scope.path}`).toString().trim(), scope.tree);
    assert.equal(hash(git('ls-tree', '-r', scope.revision, '--', scope.path)), scope.treeListingSha256);
    const expected = treeRows(scope.revision, scope.path).sort((left, right) => left.path.localeCompare(right.path));
    assert.deepEqual(liveEntries(scope.path), expected.map(({ path, mode: entryMode, type }) => ({ path, mode: entryMode, type })));
    const members = expected.filter(row => row.type === 'blob');
    assert.equal(members.length, scope.files);
    for (const member of members) assert.deepEqual(read(member.path), git('cat-file', 'blob', member.blob), member.path);
    files += members.length;
  }
  assert.equal(files, 50);
  return files;
}

function verifyArtifacts() {
  assert.equal(mode(`${directory}/MANIFEST.json`), '100644');
  const expected = manifest.allowedCommitPaths.filter(path => path.startsWith(`${directory}/`)).sort();
  assert.deepEqual(liveEntries(directory).map(entry => entry.path).sort(), expected);
  assert.equal(manifest.artifactHashes.length, 4);
  for (const artifact of manifest.artifactHashes) {
    assert.equal(mode(`${directory}/${artifact.path}`), '100644');
    assert.equal(hash(read(`${directory}/${artifact.path}`)), artifact.sha256);
  }
}

verifyArtifacts();
verifyHistory();
for (const source of identities.sources) {
  assert(!sourceBytes.has(source.id));
  const bytes = git('show', `${source.revision}:${source.path}`);
  assert.equal(bytes.length, source.bytes);
  assert.equal(hash(bytes), source.sha256);
  assert.equal(git('rev-parse', `${source.revision}:${source.path}`).toString().trim(), source.blob);
  assert.equal(git('ls-tree', source.revision, '--', source.path).toString().split(' ')[0], source.mode);
  if (source.workingMatch) {
    assert.equal(mode(source.path), source.mode);
    assert.deepEqual(read(source.path), bytes);
  }
  sourceBytes.set(source.id, bytes);
}
const sourceJson = id => JSON.parse(sourceBytes.get(id));
const finalContract = sourceJson('final');
const adoption = sourceJson('adoption');
assert.equal(hash(sourceBytes.get('qb-policy')), '96a7ae5aa36cec464a28d9ba09cfcd9791cb0dd09e80a51a6fc203cdd87b7ac6');
assert(sourceBytes.get('qb-policy').subarray(0, sourceBytes.get('qb-base').length).equals(sourceBytes.get('qb-base')));
assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', identities.revisions.qb).toString().trim().split('\n'), [
  'tests/commands/yq-design-20260828/qb-policy-v1/README.md',
  'tests/commands/yq-design-20260828/qb-policy-v1/identity.json',
]);
assert.equal(hash(manifest.rootDecisionVerbatim), manifest.rootDecisionSha256);
assert.deepEqual(manifest.authorityDiff.newRootDeltas, [
  'QBM-01:CARRY_WITHOUT_TERMINAL_FLUSH',
  'QBM-02:UNCHARGED_AFTER_AWAIT_PREALLOCATION_FINAL_PUBLICATION_GUARDS',
  'ROOT_ACCEPTS_N_REVIEW_SCOPED_STATIC_32_TUPLES_36_CONTROLS',
]);
for (const text of ['checkpoint-before-next-owned-unit', 'NOterminalflush/reset includingemptyclose', 'AFTER EVERYAWAIT', 'FINALguard BEFOREpublishingcopy/result', 'GuardsUNCHARGEDsignal/statechecks']) assert(manifest.rootDecisionVerbatim.includes(text));
for (const binding of manifest.inheritedBindings) assert.equal(hash(JSON.stringify(finalContract[binding.pointer.slice(1)])), binding.sha256);
const fixed = sourceJson('freeze-fixed-values');
assert.deepEqual(finalContract.fixedPrivateCaps.values, fixed.caps);
assert.deepEqual(finalContract.defaultBudgetMapping, fixed.budget);
assert.equal(Object.keys(fixed.caps).length, 21);
assert.equal(Object.keys(fixed.budget).length, 9);
assert.deepEqual(finalContract.diagnostics.catalogue.map(row => [row.category, row.code, row.status]), fixed.diagnostics);
assert.equal(fixed.diagnostics.length, 54);
assert.equal(adoption.diagnostics.reservedConflict.code, 'ALIAS_DUPLICATE_ANCHOR');
for (const name of ['help', 'version']) {
  const bytes = Buffer.from(finalContract.exactInformation[name]);
  assert.equal(bytes.length, fixed.information[`${name}Utf8Bytes`]);
  assert.equal(hash(bytes), fixed.information[`${name}Sha256`]);
}

function pointer(value, path) {
  for (const key of path.split('/').slice(1)) {
    assert(value !== null && typeof value === 'object' && Object.hasOwn(value, key), path);
    value = value[key];
  }
  return value;
}

const cases = new Map();
for (const group of manifest.coverage.groups) {
  const packet = sourceJson(group.source);
  assert.equal(packet.cases.length, group.records);
  assert.deepEqual(packet.cases.map(row => row.id), group.caseIds.split(' '));
  assert.equal(hash(JSON.stringify(packet.cases.map(row => ({ id: row.id, input: row.input })))), group.originalInputsSha256);
  for (const row of packet.cases) { assert(!cases.has(row.id)); cases.set(row.id, row); }
}
assert.equal(cases.size, 194);
assert.equal(manifest.coverage.recordCount, 194);
assert.deepEqual(manifest.coverage.policyHeldIds, []);
const overlays = new Map(manifest.overlays.map(row => [row.id, row]));
assert.equal(overlays.size, 8);
assert.deepEqual([...overlays.keys()].sort(), ['ENC-07','NUM-14','NUM-15','QUE-12','UTF-12','WRK-10','WRK-22','WRK-26']);
const adoptedCases = new Map(sourceJson('n-cases').cases.map(row => [row.id, row]));
assert.equal(adoptedCases.size, 32);
for (const row of manifest.overlays) {
  const original = cases.get(row.id);
  for (const field of row.fields) pointer(original, field);
  if (row.inputEquality) {
    const accepted = adoptedCases.get(row.currentExpectation.caseId);
    assert.equal(pointer(original, row.inputEquality.original), pointer(accepted, row.inputEquality.adopted));
    pointer(accepted, row.currentExpectation.pointer);
  } else if (typeof row.currentExpectation === 'object') pointer(sourceJson(row.currentExpectation.source), row.currentExpectation.pointer);
}
for (const row of cases.values()) if (row.blocked) assert.equal(overlays.get(row.id)?.state, 'RESOLVED');
assert.equal(adoptedCases.get('E-01').expect.stdout.hex, '225c7530303030220a');
assert.equal(adoptedCases.get('N2-01').expect.stdout.utf8, '1E-1147483646\n');
assert.equal(adoptedCases.get('N3-02').expect.stdout.utf8, '"🙂"\n');
assert.equal(sourceBytes.get('n-review').toString().includes('All 32 expected tuples match'), true);
assert.deepEqual(manifest.actualContradictions, []);
assert.equal(manifest.futureModule.lengthPrerequisiteRemains, false);
assert.equal(manifest.futureModule.globalGoGranted, false);
assert.equal(manifest.staticValidationReceipt.historicalCheckers.length, 7);
for (const receipt of manifest.staticValidationReceipt.historicalCheckers) {
  assert.equal(hash(read(receipt.path)), receipt.checkerSha256);
  assert.equal(receipt.exitStatus, 0);
  assert.match(receipt.stdoutSha256, /^[a-f0-9]{64}$/u);
}

function plan(pending, units) {
  if (!Number.isSafeInteger(pending) || pending < 0 || pending > 1023) return { error: 'pending' };
  if (!Number.isSafeInteger(units) || units < 0) return { error: 'units' };
  if (units === 0) return { checkpoints: 0, finalPending: pending, cost: 0 };
  if (units > Number.MAX_SAFE_INTEGER - pending) return { error: 'sum' };
  const sum = pending + units;
  const checkpoints = Math.floor((sum - 1) / 1023);
  if (checkpoints > Number.MAX_SAFE_INTEGER - units) return { error: 'total' };
  return { checkpoints, finalPending: sum - checkpoints * 1023, cost: units + checkpoints };
}

const qb = sourceJson('qb-review-cases');
const qbRows = new Map();
for (const [key, projection] of Object.entries(traces.currentProjection)) {
  assert.equal(qb[key].length, projection.count);
  for (const row of qb[key]) { assert(!qbRows.has(row.id)); qbRows.set(row.id, row); }
}
assert.equal(qbRows.size, 64);
for (const row of qb.scheduleRows) assert.deepEqual(plan(row.pending, row.units), { checkpoints: row.checkpoints, finalPending: row.finalPending, cost: row.cost });
for (const row of qb.sequenceRows) {
  const estimate = plan(row.pending, row.estimateUnits);
  const copy = plan(estimate.finalPending, row.copyUnits);
  assert.deepEqual([estimate.cost, estimate.finalPending, copy.cost, copy.finalPending, estimate.cost + copy.cost], [row.estimateCost, row.postEstimatePending, row.copyCost, row.finalPending, row.combinedCost]);
}
for (const row of qb.admissionRows) assert.equal(qbRows.get(row.schedule).cost <= row.remaining, row.beforeNextAdmits);
for (const row of qb.refusalRows) assert.deepEqual(plan(row.pending, row.units), { error: row.stage });
for (const row of qb.payloadRows) assert.equal(row.operations.reduce((total, fragments) => total + Math.ceil(fragments.reduce((bytes, value) => bytes + value, 0) / 1024), 0), row.units);
for (const row of qb.mutationRows) assert.notEqual(row.expected ?? row.expectedUnsafeAdditions, row.mutant ?? row.mutantUnsafeAdditions);
for (const row of qb.traceRows) assert.equal(row.expect.refund, 0);

for (const row of traces.handoffs) {
  for (const id of row.lineage) assert(qbRows.has(id));
  if (row.id === 'C04') {
    const estimate = plan(row.pending, row.estimateUnits);
    const copy = plan(estimate.finalPending, row.copyUnits);
    assert.deepEqual(row.expect, {
      estimateCost: estimate.cost, postEstimatePending: estimate.finalPending,
      copyCheckpoints: copy.checkpoints, copyCost: copy.cost,
      combinedCost: estimate.cost + copy.cost, finalPending: copy.finalPending,
      finishCost: 0, reservationStepCalls: 1, copyRealStepCalls: 0, copyRealTickCalls: 0,
    });
  } else {
    const result = plan(row.pending, row.units);
    assert.equal(result.cost, row.expect.cost);
    assert.equal(result.finalPending, row.expect.finalPending);
    if (row.expect.admitted !== undefined) assert.equal(result.cost <= row.remaining, row.expect.admitted);
    if (row.id === 'C01') {
      const remaining = row.remaining - result.cost;
      const next = plan(result.finalPending, 1);
      assert.deepEqual(row.expect, {
        checkpoints: result.checkpoints, cost: result.cost, admitted: true,
        finalPending: result.finalPending, remaining, finishCost: 0,
        nextReservationUnits: 1, nextReservationCost: next.cost,
        nextReservationAdmitted: next.cost <= remaining, nextCopyAllocated: false,
      });
    }
    if (row.id === 'C02') assert.deepEqual(row.expect, {
      checkpoints: result.checkpoints, cost: result.cost, admitted: true,
      finalPending: result.finalPending, remaining: row.remaining - result.cost,
      finishCost: 0, phaseCloseCost: 0, emptyCloseCost: 0, terminalTickOwed: false,
    });
    if (row.id === 'C03') {
      const next = plan(result.finalPending, 1);
      assert.deepEqual(row.expect.nextNormalUnit, { realCheckpointCost: next.checkpoints, ordinaryCost: 1, finalPending: next.finalPending });
    }
  }
  assert.equal(row.expect.finishCost, 0);
}

const reasonValues = { false: false, null: null, undefined: undefined, object: Object.freeze({ identity: 'borrowed reason' }) };
const closedIdentity = Object.freeze({ identity: 'existing closed control' });
const executionIdentity = Object.freeze({ identity: 'existing execution failure' });
const cleanupIdentity = Object.freeze({ identity: 'existing cleanup failure' });
function select(row) {
  if (row.aborted) return { kind: 'caller', reason: reasonValues[row.reason] };
  if (row.executionFailure) return { kind: 'execution', reason: executionIdentity };
  if (row.yieldFailure) return { kind: 'yield', reason: reasonValues[row.reason] };
  if (row.closed) return { kind: 'closed', reason: closedIdentity };
  if (row.cleanupFailure) return { kind: 'cleanup', reason: cleanupIdentity };
  return { kind: 'continue' };
}
assert.equal(traces.guardRows.length, 18);
assert.equal(traces.handoffs.length, 4);
assert.equal(traces.guardModel.guardCharges, 0);
for (const row of traces.guardRows) {
  assert(qbRows.has(row.lineage));
  const outcome = select(row);
  const permitted = outcome.kind === 'continue';
  const actual = {
    outcome: outcome.kind,
    charged: row.stage === 'before-admission' && !permitted ? 0 : plan(row.pending, row.units).cost,
    allocatedBeforeGuard: row.stage === 'final-publication' ? row.units : 0,
    mayAllocate: permitted && row.allocationIntent,
    mayPublish: permitted && row.publishIntent,
    pendingReset: row.stage === 'prepaid-await-fulfilled' && permitted,
    settled: row.drained,
    refund: 0,
  };
  assert.deepEqual(actual, row.expect, row.id);
  if (outcome.kind === 'caller' || outcome.kind === 'yield') assert.equal(outcome.reason, reasonValues[row.reason]);
  if (outcome.kind === 'closed') assert.equal(outcome.reason, closedIdentity);
}
assert.notEqual(select(traces.guardRows.find(row => row.id === 'G11')).kind, select(traces.guardRows.find(row => row.id === 'G12')).kind);
assert.equal(select({ ...traces.guardRows.find(row => row.id === 'G16'), drained: true }).kind, 'caller');
assert.notEqual(plan(1022,1).cost, plan(1022,1).cost + 1);
assert.notEqual(plan(1023,1).cost, plan(0,1).cost);
assert.equal(traces.guardRows.find(row => row.id === 'G01').expect.mayAllocate, false);
assert.equal(traces.guardRows.find(row => row.id === 'G06').expect.mayPublish, false);

verifyHistory();
verifyArtifacts();
assert.deepEqual(read(`${directory}/MANIFEST.json`), originalManifest);
const seal = git('log', '-1', '--format=%H', '--', `${directory}/MANIFEST.json`).toString().trim();
let delta = { status: 'UNCOMMITTED_SEAL_PREPARATION' };
if (seal) {
  const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', seal).toString().trim().split('\n').sort();
  assert.deepEqual(changed, manifest.allowedCommitPaths);
  const bytes = git('diff', '--binary', '--full-index', `${seal}^`, seal, '--', ...manifest.allowedCommitPaths);
  delta = { status: 'EXACT_OWNED_SEAL_DELTA', commit: seal, files: changed.length, sha256: hash(bytes) };
}
console.log(JSON.stringify({
  status: 'FINAL_CARRY_STATIC_CHECKS_PASS_NOT_RUNTIME_ACCEPTANCE', originalIds: cases.size,
  fieldOverlays: overlays.size, policyHolds: 0, immutableFiles: 50, immutableSubtrees: 8,
  selectedSources: sourceBytes.size, inheritedCaps: 21, budgetFields: 9, catalogueEntries: 54,
  originalQbRowsUnchanged: 64, currentArithmeticControlProjections: 52,
  currentHistoricalTraceViews: 12, guardProjections: 18, handoffProjections: 4,
  rootDecisionSha256: manifest.rootDecisionSha256, delta,
  historicalResultsRescored: false, author23RowsExecuted: false,
  productExecutions: 0, nativeOrParserExecutions: 0, artifactWrites: 0,
}, null, 2));
