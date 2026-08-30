import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { authenticatePacket } from './authorization.mjs';
import { phasePlan, bindGrantPlan, authorizeOperation } from './operations.mjs';
import { createLedger, launchTracked } from './launch-ledger.mjs';
import { supervise } from './supervisor.mjs';
import { settle, hash, requireThat, errorRecord, serial, settled } from './safety.mjs';
import { qualify, assessWorkflow } from './predicates.mjs';
import { syntheticReport } from './controls.mjs';
import { assessLoadedNoop } from './loaded-outcome.mjs';
import { observe } from './adapter.mjs';
import { boundFile, writeView, inspectTree } from '../executor-v3/projection.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
const recipe = authenticatePacket(root);
const projection = read('../executor-v3/PROJECTION.json');
for (const tool of projection.tools) boundFile(tool.path, tool);
const node = projection.tools.find(tool => tool.role === 'node').path;
const runId = process.argv[2];
requireThat(/^[a-z0-9-]{1,64}$/.test(runId ?? ''), 'RUN_ID', runId);
requireThat(process.execArgv.includes('--unhandled-rejections=strict'), 'STRICT_UNHANDLED_POLICY', process.execArgv);
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
const outputRoot = path.join(root, 'runs', runId);
fs.mkdirSync(outputRoot);
const plan = read('OPERATION-PLAN.json');
const fixtures = read('FOCUSED-FIXTURES.json');
const workflows = read('../WORKFLOWS.json').rows;
const legacy = read('../LEGACY-RECIPES.json').rows.map(row => row.recipe);
const specimens = new Map([...workflows, ...legacy].map(row => [row.id, row]));
const tests = [];
const ledgers = [];
const outcomes = [];
const observations = [];
let evidenceBytes = 0;
const save = (folder, filename, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  evidenceBytes += bytes.length;
  requireThat(evidenceBytes <= 33554432, 'FOCUSED_EVIDENCE_CAP', evidenceBytes);
  fs.writeFileSync(path.join(folder, filename), bytes, { flag: 'wx', mode: 0o644 });
  return hash(bytes);
};
const test = (id, action) => tests.push({ id, action });
const guard = () => requireThat(authenticatePacket(root) === recipe, 'RECIPE_CHANGED', recipe);
const modelChild = () => ({ pid: 1000000000, reaped: true, exit: { code: 0, signal: null }, close: { code: 0, signal: null }, signals: [], failures: [] });
const modelReport = row => ({ ...syntheticReport(row), cleanup: { completion: 'returned' }, safety: { safe: true }, loads: { count: 1, evaluated: true, denied: [] }, resources: { pending: 0, violations: [] }, late: [], postGuard: true });
function contextFor(phase) {
  const context = { root, phase, runId: 'plan-model', outputRoot: path.join(root, 'runs', 'plan-model') };
  const approved = { phase, runId: context.runId, outputRoot: context.outputRoot, planSha256: hash(JSON.stringify(phasePlan(plan, phase))), command: { entry: 'coordinator.mjs', phase, runId: context.runId, nodeArgs: plan.command.nodeArgs } };
  return { context, approved };
}
function configuration(operation) {
  return { kind: operation.kind, operationId: operation.id, operationOrdinal: operation.ordinal, launchOrdinal: 1, view: { name: operation.layout, oldOrigin: null }, ...(operation.kind === 'C11' ? { negative: operation.negative } : {}), ...(operation.kind === 'case' ? { specimen: specimens.get(operation.caseId) } : {}) };
}
test('D01-frozen-cardinality-and-budget', () => {
  assert.equal(plan.admission.length, 14); assert.equal(plan.cohort.length, 99);
  assert.equal(plan.admission.filter(row => row.kind === 'C11').length, 2);
  assert.equal(plan.admission.filter(row => row.kind === 'case').length, 0);
  assert.equal(plan.limits.admissionChildren, 27);
  assert.equal(plan.admission.filter(row => row.worker === 'control').length, 9);
});
test('D02-all-scheduled-specimens-exact', () => {
  assert(plan.cohort.every(row => hash(JSON.stringify(specimens.get(row.caseId))) === row.specimenSha256));
  assert.equal(new Set(plan.cohort.map(row => `${row.layout}:${row.caseId}`)).size, 99);
});
for (const phase of ['admission', 'cohort']) test(`R1-${phase}-allowed-operations-model`, () => {
  const { context, approved } = contextFor(phase);
  for (const operation of plan[phase].filter(row => row.worker === 'engine')) assert.equal(authorizeOperation(approved, configuration(operation), plan, context, 'engine'), operation);
});
test('R1-control-worker-exact-frozen-operations-only', () => {
  const { context, approved } = contextFor('admission');
  for (const operation of plan.admission.filter(row => row.worker === 'control')) {
    const config = { kind: 'control', family: operation.family, mode: operation.mode, entry: operation.entry, operationId: operation.id, operationOrdinal: operation.ordinal, view: { root: path.join(context.outputRoot, 'synthetic-view'), files: operation.files } };
    assert.equal(authorizeOperation(approved, config, plan, context, 'control'), operation);
    assert.throws(() => authorizeOperation(approved, { ...config, entry: '../unbound-source.mjs' }, plan, context, 'control'), { code: 'CONTROL_OPERATION_BINDING' });
  }
});
test('R1-cohort-grant-rejects-control-worker', () => { const { context, approved } = contextFor('cohort'); assert.throws(() => authorizeOperation(approved, { kind: 'control' }, plan, context, 'control'), { code: 'OPERATION_PHASE' }); });
for (const [id, phase, mutate, code] of [
  ['admission-case', 'admission', config => { config.kind = 'case'; }, 'OPERATION_PHASE'],
  ['cohort-C11', 'cohort', config => { config.kind = 'C11'; }, 'OPERATION_PHASE'],
  ['unknown-kind', 'admission', config => { config.kind = 'unknown'; }, 'OPERATION_PHASE'],
  ['wrong-layout', 'admission', config => { config.view.name = 'target-moved'; }, 'OPERATION_LAYOUT'],
  ['wrong-ordinal', 'cohort', config => { config.operationOrdinal++; }, 'OPERATION_BINDING'],
  ['wrong-specimen', 'cohort', config => { config.specimen = { ...config.specimen, script: 'UNAPPROVED' }; }, 'OPERATION_SPECIMEN'],
  ['probe-hidden-case', 'admission', config => { config.specimen = {}; }, 'OPERATION_ARGUMENTS'],
]) test(`R1-reject-${id}`, () => {
  const { context, approved } = contextFor(phase); const config = configuration(plan[phase][0]); mutate(config);
  assert.throws(() => authorizeOperation(approved, config, plan, context, 'engine'), { code });
});
for (const [name, alter, code] of [
  ['run', grant => { grant.runId = 'other'; }, 'GRANT_RUN_BINDING'],
  ['output', grant => { grant.outputRoot += '-other'; }, 'GRANT_RUN_BINDING'],
  ['plan', grant => { grant.planSha256 = '0'.repeat(64); }, 'GRANT_PLAN_BINDING'],
  ['command', grant => { grant.command.nodeArgs = []; }, 'GRANT_COMMAND_BINDING'],
]) test(`R1-grant-${name}`, () => { const { context, approved } = contextFor('admission'); alter(approved); assert.throws(() => bindGrantPlan(approved, context, plan), { code }); });
const workerText = fs.readFileSync(path.join(root, 'worker.mjs'), 'utf8');
const prefix = workerText.slice(workerText.indexOf('  const configPath ='), workerText.indexOf('  loader = installLoader'));
test('R1-exact-preimport-prefix-wrong-phases', () => {
  assert(prefix.includes('authorizeOperation(')); assert(!prefix.includes('await import('));
  const execute = new Function('fs', 'process', 'hash', 'requireThat', 'readJson', 'path', 'root', 'authority', 'authorizeOperation', 'authenticateView', 'inspectTree', prefix);
  for (const [phase, kind] of [['admission', 'case'], ['cohort', 'C11']]) {
    const { context, approved } = contextFor(phase);
    const config = { ...configuration(plan[phase][0]), kind, authorization: { phase } };
    const bytes = Buffer.from(JSON.stringify(config)); let claims = 0;
    assert.throws(() => execute({ readFileSync: () => bytes, existsSync: () => false, writeFileSync: () => { claims++; } }, { argv: ['node', 'worker', path.join(context.outputRoot, 'child-001.json'), hash(bytes)], execArgv: ['--unhandled-rejections=strict'] }, hash, requireThat, () => ({}), path, root, () => ({ approved, plan, context, phase }), authorizeOperation, () => {}, () => {}), { code: 'OPERATION_PHASE' });
    assert.equal(claims, 0);
  }
  observations.push({ prefixSha256: hash(prefix), actualEngineImports: 0, modelDependencies: true });
});
for (const [name, primary] of [['null', null], ['undefined', undefined]]) {
  test(`R2-${name}-primary-with-later-faults`, async () => {
    let disposal = 0;
    const receipt = await settle({ body: async () => { throw primary; }, emit: async phase => { throw new Error(`later:${phase}`); }, dispose: async () => { disposal++; throw new Error('later:cleanup'); } });
    assert.equal(receipt.hasPrimary, true); assert.equal(receipt.primary, primary); assert.equal(disposal, 1);
    assert.equal(receipt.safe, false); assert.deepEqual(receipt.errors.map(row => row.phase), ['body', 'emit:dispose-start', 'dispose', 'emit:dispose-settled']);
    observations.push({ id: name, hasPrimary: receipt.hasPrimary, primaryKind: name, errors: receipt.errors });
  });
  test(`R2-${name}-actual-adapter-mock-boundary`, async () => {
    let disposal = 0;
    class MockShell { use() {} async dispose() { disposal++; throw new Error('cleanup'); } }
    const library = { Shell: MockShell, createMemoryFileSystem: () => ({ async mkdir() { throw primary; } }), agentCommands: () => ({}) };
    const report = await observe({ library, engine: 'virtual-bash', specimen: specimens.get('W01'), bindings: { target: { defaultNames: [] } }, namespaces: {}, emit: async event => { if (event.event.startsWith('dispose-')) throw new Error('secondary-emission'); }, authorization: { rootGo: true, differentFreeze: 'synthetic-mock-only', candidate: projection.candidate } });
    assert.equal(disposal, 1); assert.equal(report.safety.hasPrimary, true); assert.equal(report.error.message, name);
    assert.equal(report.safety.safe, false); assert(report.safety.errors.some(row => row.phase === 'dispose'));
  });
}
test('R2-no-rejection-distinct-from-undefined-rejection', async () => { const report = await settle({ body: async () => undefined, dispose: async () => {} }); assert.equal(report.hasPrimary, false); assert.equal(report.safe, true); });
test('B1-complete-standalone-model-positive', () => { assert.equal(qualify(specimens.get('W01'), modelReport(specimens.get('W01')), modelChild(), true, 'virtual-bash').pass, true); });
for (const [name, mutate] of [
  ['missing-late', report => { delete report.late; }],
  ['late-error', report => { report.late = [{ message: 'unhandled' }]; }],
  ['denied-load', report => { report.loads.denied = [{ code: 'UNBOUND_MODULE' }]; }],
  ['missing-post-guard', report => { delete report.postGuard; }],
  ['contradictory-execution-error', report => { report.executionError = { message: 'execution failed' }; }],
]) test(`B1-reject-${name}-standalone-not-composed-bypass`, () => { const report = modelReport(specimens.get('W01')); mutate(report); assert.equal(qualify(specimens.get('W01'), report, modelChild(), true, 'virtual-bash').safe, false); });
test('B1-settled-execution-error-without-result-remains-failure', () => { const report = modelReport(specimens.get('W01')); delete report.result; report.executionError = { message: 'ordinary execution failure' }; const result = qualify(specimens.get('W01'), report, modelChild(), true, 'virtual-bash'); assert.equal(result.safe, true); assert.equal(result.pass, false); });
test('W07-comparator-matching-bytes-never-semantic-credit', () => {
  const report = modelReport(specimens.get('W07')); report.additionalObservations['No fixture executable is executed'] = false;
  const result = qualify(specimens.get('W07'), report, modelChild(), true, 'just-bash');
  assert.equal(result.status, 'UNQUALIFIED_UNCREDITED'); assert.equal(result.pass, null); assert.equal(result.semanticCredit, false); assert.equal(result.nonExecutionCredit, false); assert.equal(result.assessment.matchingBytesOnly, true);
  assert(result.assessment.checks.some(check => check.id === 'OBSERVATION:No fixture executable is executed' && !check.pass));
});
test('W07-target-obligation-not-weakened', () => { const report = modelReport(specimens.get('W07')); report.additionalObservations['No fixture executable is executed'] = false; assert.equal(assessWorkflow(specimens.get('W07'), report, 'virtual-bash').pass, false); });
test('W07-comparator-wrong-bytes-still-fail', () => { const report = modelReport(specimens.get('W07')); report.result.stdoutBase64 = 'eA=='; const result = assessWorkflow(specimens.get('W07'), report, 'just-bash'); assert.equal(result.pass, false); assert.equal(result.status, 'FAILED'); assert.equal(result.semanticCredit, false); });

const regularLedger = createLedger(3); ledgers.push({ name: 'loaded-outcomes', ledger: regularLedger, intentionalUnsafe: false });
function makeView(folder) {
  const view = { root: path.join(folder, 'focused-view'), files: fixtures };
  writeView(view.root, fixtures, entry => fs.readFileSync(path.join(root, 'fixtures', entry.path)));
  return view;
}
const view = makeView(outputRoot);
async function child(entryName, ledger, folder, selectedView, failPersistence = false) {
  const receipt = await launchTracked({ ledger, kind: 'focused-control', prepare: async entry => {
    const filename = `child-${String(entry.ordinal).padStart(3, '0')}.json`;
    const config = { kind: 'focused-control', mode: 'load', entry: entryName, view: selectedView };
    return { filename, configSha: save(folder, filename, config) };
  }, supervise: (prepared, onSpawn) => supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'synthetic-worker.mjs'), path.join(folder, prepared.filename), prepared.configSha], folder, { onSpawn(handle, state) {
    onSpawn(handle, state);
    observations.push({ kind: 'before-receipt-persistence', pid: handle.pid, ledgerPid: ledger.entries.at(-1).pid, group: ledger.entries.at(-1).group, enrolled: ledger.entries.length });
  } }), persist: (entry, result) => {
    assert.equal(entry.pid, result.pid); assert.equal(entry.group, -result.pid); assert.equal(entry.reaped, result.reaped); assert.equal(entry.state, 'SUPERVISED');
    if (failPersistence) return save(folder, 'collision.json', result);
    return save(folder, `child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`, result);
  } });
  requireThat(settled(receipt), 'FOCUSED_CHILD_UNSAFE', receipt);
  return receipt;
}
for (const [entry, expectedPass, expectedStatus] of [['noop.mjs', true, 0], ['wrong-status.mjs', false, 7], ['actual-effects.mjs', false, 0]]) test(`R3-actual-loaded-${entry}`, async () => {
  const receipt = await child(entry, regularLedger, outputRoot, view);
  const observed = receipt.records.at(-1).report;
  const result = assessLoadedNoop(specimens.get('W02'), syntheticReport(specimens.get('W02')).before, observed, receipt.records.filter(row => row.kind === 'nextLoad'));
  assert.equal(result.pass, expectedPass); assert.equal(result.actualStatus, expectedStatus);
  assert.deepEqual(result.actualEffects, observed.observation.files);
  if (entry === 'actual-effects.mjs') { assert.equal(result.assessment.pass, true); assert.equal(result.report.after.entries.find(row => row.path === '/fixture/part-aa').base64, 'YWxwaGEKYmV0YQo='); }
  observations.push({ id: `R3:${entry}`, result, actualLoadCount: receipt.records.filter(row => row.kind === 'nextLoad').length });
});
test('R4-enrolled-before-prepare-failure-model', async () => {
  const ledger = createLedger(1);
  await assert.rejects(launchTracked({ ledger, kind: 'model-only', prepare: () => { assert.equal(ledger.entries.length, 1); throw new Error('capture-config'); }, supervise: () => assert.fail('must not launch'), persist: () => assert.fail('must not persist') }), { code: 'LAUNCH_UNSAFE' });
  assert.equal(ledger.summary().attempted, 0); assert.equal(ledger.summary().allChildrenReaped, null); assert.equal(ledger.summary().unsafe, true);
});
test('R4-unreaped-returned-receipt-cannot-disappear-model', () => {
  const ledger = createLedger(1); const entry = ledger.enroll('model-only'); ledger.starting(entry);
  ledger.complete(entry, { ...modelChild(), reaped: false, close: null }); ledger.failed(entry, 'persist', new Error('capture-write'));
  assert.equal(ledger.entries.length, 1); assert.equal(ledger.summary().launched, 1); assert.equal(ledger.summary().allChildrenReaped, false); assert.equal(entry.emergencyReceipt.reaped, false);
});
test('R4-supervision-exception-retains-unknown-acquisition', async () => {
  const ledger = createLedger(1);
  await assert.rejects(launchTracked({ ledger, kind: 'model-only', prepare: () => ({ configSha: 'synthetic' }), supervise: () => { throw new Error('supervision-failure'); }, persist: () => assert.fail('must not persist') }), { code: 'LAUNCH_UNSAFE' });
  assert.equal(ledger.summary().unknownAcquisitions, 1); assert.equal(ledger.summary().allChildrenReaped, false); assert.equal(ledger.entries[0].errors[0].phase, 'supervise');
});
test('R4-real-receipt-write-failure-keeps-closure-and-stops-tail', async () => {
  const folder = path.join(outputRoot, 'persistence-negative'); fs.mkdirSync(folder);
  const selectedView = makeView(folder); save(folder, 'collision.json', { intentionalExistingCapture: true });
  const ledger = createLedger(2); ledgers.push({ name: 'intentional-persistence-failure', ledger, intentionalUnsafe: true });
  let calls = 0;
  const result = await serial([{ id: 'write-fails' }, { id: 'must-remain-unrun' }], async () => { calls++; await child('noop.mjs', ledger, folder, selectedView, true); return { safe: true, pass: true }; }, guard);
  assert.equal(calls, 1); assert.equal(result.unsafe, true); assert.equal(result.rows[1].status, 'UNRUN_UNSAFE_TAIL');
  const summary = ledger.summary(); assert.equal(summary.launched, 1); assert.equal(summary.closed, 1); assert.equal(summary.allChildrenReaped, true); assert.equal(summary.unsafe, true);
  assert.equal(ledger.entries[0].errors[0].error.code, 'EEXIST'); assert(ledger.entries[0].emergencyReceipt.records.some(row => row.kind === 'nextLoad'));
  assert.throws(() => ledger.enroll('forbidden-next-launch'), { code: 'LAUNCH_LEDGER_BOUND' });
  observations.push({ id: 'R4:actual-persistence-negative', result, summary });
});

requireThat(tests.length === 40, 'FOCUSED_ASSERTION_COUNT', tests.length);
save(outputRoot, 'PLAN.json', { recipe, tests: tests.map(row => row.id), maxChildren: 4, oldReview: 'e8e71baf2647c6cb0b0c3ed04900c60627f36990', oldCountsPreserved: '35/44;13 data;22/31 synthetic;9 failures', productImports: 0, comparatorImports: 0, actualC11: 0 });
let unsafe = false;
for (const item of tests) {
  if (unsafe) { outcomes.push({ id: item.id, status: 'UNRUN_UNSAFE_TAIL' }); continue; }
  try { guard(); await item.action(); guard(); inspectTree(view.root, fixtures); outcomes.push({ id: item.id, status: 'EXPECTED_OUTCOME', pass: true }); }
  catch (error) {
    const closure = ledgers.every(row => row.ledger.summary().attempted === 0 || row.ledger.summary().allChildrenReaped === true);
    try { guard(); } catch (guardError) { observations.push({ integrityError: errorRecord(guardError) }); unsafe = true; }
    if (error.code !== 'ERR_ASSERTION' || !closure) unsafe = true;
    outcomes.push({ id: item.id, status: unsafe ? 'UNSAFE_STOP' : 'ASSERTION_FAILED', pass: false, error: errorRecord(error) });
  }
}
for (const tool of projection.tools) boundFile(tool.path, tool);
guard();
const result = { schema: 'breadth-v4-focused-data-synthetic-only', recipe, outcomes, observations, counts: { passed: outcomes.filter(row => row.pass).length, failed: outcomes.filter(row => row.pass === false).length, unrun: outcomes.filter(row => row.status === 'UNRUN_UNSAFE_TAIL').length }, ledgers: ledgers.map(row => ({ name: row.name, intentionalUnsafe: row.intentionalUnsafe, entries: row.ledger.entries, summary: row.ledger.summary() })), unsafe, oldReviewUnchanged: true, engineImports: 0, packageStaging: 0, actualC11: 0, native: 0, timingCohort: 0 };
save(outputRoot, 'RESULT.json', result);
process.stdout.write(`${JSON.stringify({ recipe, counts: result.counts, unsafe, children: result.ledgers.reduce((sum, row) => sum + row.summary.launched, 0), report: path.join(outputRoot, 'RESULT.json') })}\n`);
if (unsafe || result.counts.failed) process.exitCode = 1;
