import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { own, repository, author, hash, git, verify, fingerprint } from './freeze.mjs';

const read = filename => JSON.parse(fs.readFileSync(filename));
const freeze = read(path.join(own, 'FREEZE.json'));
const initial = verify(freeze);
const presealCommit = git('log', '-1', '--format=%H', '--', path.relative(repository, path.join(own, 'FREEZE.json'))).trim();
assert.match(presealCommit, /^[0-9a-f]{40}$/);
assert.equal(git('diff', presealCommit, '--', path.relative(repository, own)), '');
assert.equal(process.version, 'v22.22.2');
assert(process.execArgv.includes('--unhandled-rejections=strict'));
assert(process.execArgv.includes('--max-old-space-size=128'));
const output = path.join(own, 'evidence-01');
fs.mkdirSync(output);
let evidenceBytes = 0;
function save(name, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  evidenceBytes += bytes.length;
  assert(evidenceBytes <= 8 * 1024 * 1024);
  fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
  return hash(bytes);
}
save('INITIAL.json', { ...initial, presealCommit, freezeSha256: fingerprint(path.join(own, 'FREEZE.json')).sha256, started: new Date().toISOString(), argv: process.execArgv, gitStatus: git('status', '--porcelain=v1', '--untracked-files=all'), index: git('diff', '--cached', '--name-status') });
const helper = name => import(pathToFileURL(path.join(author, name)).href);
const { settle, errorRecord, requireThat, serial } = await helper('safety.mjs');
const { bindGrantPlan, authorizeOperation } = await helper('operations.mjs');
const { qualify, assessWorkflow } = await helper('predicates.mjs');
const { assessLoadedNoop } = await helper('loaded-outcome.mjs');
const { observe } = await helper('adapter.mjs');
const { createLedger, launchTracked } = await helper('launch-ledger.mjs');
const { supervise } = await helper('supervisor.mjs');
const expected = read(path.join(own, 'EXPECTATIONS.json'));
const plan = read(path.join(author, 'OPERATION-PLAN.json'));
const workflows = read(path.join(author, '../WORKFLOWS.json')).rows;
const legacy = read(path.join(author, '../LEGACY-RECIPES.json')).rows.map(row => row.recipe);
const specimens = new Map([...workflows, ...legacy].map(row => [row.id, row]));
const tests = [];
const rows = [];
const details = {};
const children = [];
const ledgers = [];
let safeToLaunch = true;
const watchdog = setTimeout(() => { process.stderr.write('Independent review outer watchdog expired\n'); process.exitCode = 1; }, 30000);
const test = (id, action) => tests.push({ id, action });
const rejectsCode = (action, code) => assert.throws(action, error => error.code === code);
function contextFor(phase) {
  const context = { root: author, phase, runId: 'independent-config-model', outputRoot: path.join(author, 'runs/independent-config-model') };
  const grant = { phase, runId: context.runId, outputRoot: context.outputRoot, planSha256: hash(JSON.stringify({ limits: plan.limits, command: plan.command, phase, operations: plan[phase] })), command: { entry: 'coordinator.mjs', phase, runId: context.runId, nodeArgs: ['--unhandled-rejections=strict', '--max-old-space-size=256'] } };
  return { context, grant };
}
function configFor(operation, context) {
  const config = { kind: operation.kind, operationId: operation.id, operationOrdinal: operation.ordinal, launchOrdinal: 1, view: { name: operation.layout } };
  if (operation.kind === 'C11') config.negative = operation.negative;
  if (operation.kind === 'case') config.specimen = structuredClone(specimens.get(operation.caseId));
  if (operation.worker === 'control') Object.assign(config, { family: operation.family, mode: operation.mode, entry: operation.entry, view: { root: path.join(context.outputRoot, 'synthetic-view'), files: structuredClone(operation.files) } });
  return config;
}
const workerSource = fs.readFileSync(path.join(author, 'worker.mjs'), 'utf8');
const prefixStart = workerSource.indexOf('  const configPath =');
const prefixEnd = workerSource.indexOf('  loader = installLoader');
assert(prefixStart > 0 && prefixEnd > prefixStart);
const prefix = workerSource.slice(prefixStart, prefixEnd);
assert(!prefix.includes('await import('));
details.prefix = { sha256: hash(prefix), startLine: workerSource.slice(0, prefixStart).split('\n').length, endsBefore: 'loader = installLoader', exactSource: true, dependencies: 'synthetic authority/fs/view; actual authorizeOperation; no engine import' };
function runPrefix(config, phase, options = {}) {
  const { context, grant } = contextFor(phase);
  const events = [];
  const configBytes = Buffer.from(JSON.stringify(config));
  const configPath = path.join(context.outputRoot, options.filename ?? 'child-001.json');
  const mockFs = { readFileSync: filename => { assert.equal(filename, configPath); events.push('read-config'); return configBytes; }, writeFileSync: (filename, bytes, flags) => { events.push('claim'); assert(filename.endsWith(`operation-${config.operationId}.claim`)); assert.equal(flags.flag, 'wx'); }, existsSync: () => false };
  const mockAuthority = () => { events.push('authority'); bindGrantPlan(grant, context, plan); return { approved: grant, context, plan, phase, recipe: freeze.recipeSha256 }; };
  const mockProcess = { argv: ['node', 'worker', configPath, hash(configBytes)], execArgv: options.execArgv ?? ['--unhandled-rejections=strict'] };
  const execute = new Function('fs', 'path', 'root', 'process', 'readJson', 'authority', 'authorizeOperation', 'requireThat', 'hash', 'authenticateView', 'inspectTree', `${prefix}\nreturn operation;`);
  try {
    const operation = execute(mockFs, path, author, mockProcess, () => ({}), mockAuthority, authorizeOperation, requireThat, hash, () => events.push('view-auth'), () => events.push('tree'));
    return { operation, events };
  } catch (error) { error.independentEvents = events; throw error; }
}
test('D01-plan-budget', () => {
  assert.deepEqual(plan.limits, { admissionChildren: 27, admissionPlanned: 14, cohortChildren: 99, admissionSetup: 2, admissionSemantics: 0, deadlineMs: 30000, graceMs: 2000, killMs: 1000, outerMs: 4500000, metadataBytes: 262144, newPerStreamBytes: 65536, legacyCombinedBytes: 8388608, evidenceBytes: 268435456 });
  assert.equal(plan.admission.length, 14); assert.equal(plan.cohort.length, 99);
  assert.equal(plan.admission.filter(row => row.kind === 'C11').length, 2);
  assert.equal(plan.admission.filter(row => row.kind === 'case').length, 0);
  for (const operation of plan.cohort) assert.equal(hash(JSON.stringify(specimens.get(operation.caseId))), operation.specimenSha256);
  details.budgets = { limits: plan.limits, command: plan.command, phasePlanSha256: contextFor('admission').grant.planSha256 };
});
test('D02-strict-forwarding-and-import-order', () => {
  const source = fs.readFileSync(path.join(author, 'coordinator.mjs'), 'utf8');
  const launchLine = source.split('\n').find(line => line.includes('supervise: (prepared, onSpawn)'));
  assert(launchLine.includes("['--unhandled-rejections=strict', '--max-old-space-size=256'"));
  assert(launchLine.includes("synthetic ? 'synthetic-worker.mjs' : 'worker.mjs'"));
  assert(prefix.indexOf('authorizeOperation(') < prefix.indexOf('fs.writeFileSync('));
  assert(prefix.indexOf('STRICT_UNHANDLED_POLICY') < prefix.indexOf('fs.writeFileSync('));
  const synthetic = fs.readFileSync(path.join(author, 'synthetic-worker.mjs'), 'utf8');
  assert(synthetic.indexOf('authorizeOperation(permission.approved') < synthetic.indexOf('loader = installLoader'));
  assert(synthetic.indexOf('STRICT_UNHANDLED_POLICY') < synthetic.indexOf('loader = installLoader'));
  details.strictForwarding = { actualCoordinatorLine: launchLine, actualWorkerPrefix: true, actualEngineChildUnrun: true };
});
for (const [id, phase, config] of [
  ['R1-admission-prefix-rejects-case', 'admission', { kind: 'case' }],
  ['R1-cohort-prefix-rejects-C11', 'cohort', { kind: 'C11', negative: true }],
  ['R1-prefix-rejects-unknown', 'admission', { kind: 'future-unregistered-operation' }]
]) test(id, () => assert.throws(() => runPrefix(config, phase), error => error.code === 'OPERATION_PHASE' && !error.independentEvents.includes('claim') && !error.independentEvents.includes('view-auth')));
test('R1-prefix-valid-and-claim-order', () => {
  const { context } = contextFor('admission');
  const result = runPrefix(configFor(plan.admission[1], context), 'admission');
  assert.equal(result.operation.layout, 'target-moved');
  assert.deepEqual(result.events, ['read-config', 'authority', 'claim', 'view-auth', 'tree']);
});
test('R1-prefix-strict-and-launch-path', () => {
  const config = configFor(plan.admission[0], contextFor('admission').context);
  for (const [options, code] of [[{ execArgv: [] }, 'STRICT_UNHANDLED_POLICY'], [{ filename: 'child-002.json' }, 'CONFIG_OPERATION_PATH']]) {
    assert.throws(() => runPrefix(config, 'admission', options), error => error.code === code && !error.independentEvents.includes('claim'));
  }
});
test('R1-phase-plan-grant-mutations', () => {
  details.grantRejects = [];
  for (const phase of ['admission', 'cohort']) {
    const { grant, context } = contextFor(phase);
    bindGrantPlan(grant, context, plan);
    for (const [name, mutate, code] of [
      ['run', value => { value.runId += '-replay'; }, 'GRANT_RUN_BINDING'],
      ['output', value => { value.outputRoot += '-sibling'; }, 'GRANT_RUN_BINDING'],
      ['phase', value => { value.phase = phase === 'admission' ? 'cohort' : 'admission'; }, 'GRANT_RUN_BINDING'],
      ['budget-plan', value => { value.planSha256 = hash(JSON.stringify({ ...plan.limits, admissionChildren: 28 })); }, 'GRANT_PLAN_BINDING'],
      ['command', value => { value.command.nodeArgs.reverse(); }, 'GRANT_COMMAND_BINDING']
    ]) {
      const changed = structuredClone(grant); mutate(changed);
      rejectsCode(() => bindGrantPlan(changed, context, plan), code);
      details.grantRejects.push({ phase, name, code });
    }
  }
});
test('R1-operation-layout-specimen-mutations', () => {
  const { context, grant } = contextFor('cohort');
  const operation = plan.cohort.find(row => row.layout === 'target-moved' && row.caseId === 'W02');
  const config = configFor(operation, context);
  assert.equal(authorizeOperation(grant, config, plan, context, 'engine'), operation);
  for (const [mutate, code] of [
    [value => { value.operationOrdinal++; }, 'OPERATION_BINDING'],
    [value => { value.view.name = 'target-installed'; }, 'OPERATION_LAYOUT'],
    [value => { value.specimen.files.rows.mode ^= 0o100; }, 'OPERATION_SPECIMEN'],
    [value => { value.specimen.script += '\n:'; }, 'OPERATION_SPECIMEN'],
    [value => { value.negative = false; }, 'OPERATION_SPECIMEN']
  ]) { const changed = structuredClone(config); mutate(changed); rejectsCode(() => authorizeOperation(grant, changed, plan, context, 'engine'), code); }
});
test('R1-control-binding-mutations', () => {
  const { context, grant } = contextFor('admission');
  const operation = plan.admission.find(row => row.id === 'C12-loaded-noop');
  assert(operation);
  const config = configFor(operation, context);
  authorizeOperation(grant, config, plan, context, 'control');
  for (const [mutate, code] of [
    [value => { value.entry = 'other.mjs'; }, 'CONTROL_OPERATION_BINDING'],
    [value => { value.family = 'C11'; }, 'CONTROL_OPERATION_BINDING'],
    [value => { value.view.files[0].sha256 = '0'.repeat(64); }, 'CONTROL_OPERATION_BINDING'],
    [value => { value.view.root += '-neighbor'; }, 'CONTROL_OPERATION_BINDING'],
    [value => { value.specimen = {}; }, 'CONTROL_ARGUMENTS']
  ]) { const changed = structuredClone(config); mutate(changed); rejectsCode(() => authorizeOperation(grant, changed, plan, context, 'control'), code); }
});
for (const [name, primary] of [['null', null], ['undefined', undefined], ['Error', new Error('independent primary')], ['zero', 0]]) test(`R2-${name}-primary`, async () => {
  let disposal = 0;
  const result = await settle({ body: async () => { throw primary; }, dispose: async () => { disposal++; throw new Error('independent disposal'); }, emit: async phase => { throw new Error(`independent emission ${phase}`); } });
  assert(Object.is(result.primary, primary)); assert.equal(result.hasPrimary, true); assert.equal(disposal, 1); assert.equal(result.safe, false);
  assert.deepEqual(result.errors.map(entry => entry.phase), ['body', 'emit:dispose-start', 'dispose', 'emit:dispose-settled']);
  assert.equal(result.errors[0].error.message, String(primary?.message ?? primary));
  class MockShell { use() {} async dispose() { disposal++; throw new Error('adapter cleanup'); } }
  const report = await observe({ library: { Shell: MockShell, agentCommands: () => ({}), createMemoryFileSystem: () => ({ async mkdir() { throw primary; } }) }, engine: 'virtual-bash', specimen: specimens.get('W02'), bindings: { target: { defaultNames: [] } }, namespaces: {}, emit: async event => { if (event.event.startsWith('dispose-')) throw new Error(`adapter ${event.event}`); }, authorization: { rootGo: true, differentFreeze: 'INDEPENDENT_MOCK_NOT_AUTHORITY', candidate: '67eab12e315054907ef4ef435c6bbca2f59e0c36' } });
  assert.equal(disposal, 2); assert.equal(report.error.message, String(primary?.message ?? primary)); assert.equal(report.safety.hasPrimary, true);
  assert.deepEqual(report.safety.errors.map(entry => entry.phase), ['body', 'emit:dispose-start', 'dispose', 'emit:dispose-settled']);
  details[`R2-${name}`] = { primaryIdentity: true, result, report };
});
test('R2-no-primary', async () => {
  const result = await settle({ body: async () => undefined, dispose: async () => {} });
  assert.equal(result.hasPrimary, false); assert.equal(result.safe, true); assert.equal(result.errors.length, 0);
});
function modelReport(specimen) {
  const initial = [{ path: '/fixture', type: 'directory', mode: 0o777 }, ...specimen.directories.map(name => ({ path: `/fixture/${name}`, type: 'directory', mode: 0o777 })), ...Object.entries(specimen.files).map(([name, file]) => ({ path: `/fixture/${name}`, type: 'file', ...file }))];
  const additions = specimen.id === 'W02' ? { 'part-aa': 'YWxwaGEKYmV0YQo=', 'part-ab': 'Z2FtbWEK', joined: 'YWxwaGEKYmV0YQpnYW1tYQo=' } : { resolved: 'L2ZpeHR1cmUvYmluL3Rvb2wK' };
  return { captureErrors: [], before: { complete: true, entries: initial }, after: { complete: true, entries: [...structuredClone(initial), ...Object.entries(additions).map(([name, base64]) => ({ path: `/fixture/${name}`, type: 'file', base64 }))] }, result: { exitCode: 0, stdoutBase64: specimen.id === 'W02' ? 'YWxwaGEKYmV0YQpnYW1tYQo=' : 'L2ZpeHR1cmUvYmluL3Rvb2wK', stderrBase64: '' }, additionalObservations: Object.fromEntries((specimen.additionalObservations ?? []).map(name => [name, true])), cleanup: { completion: 'returned' }, safety: { safe: true }, loads: { count: 1, evaluated: true, denied: [] }, resources: { pending: 0, violations: [] }, late: [], postGuard: true };
}
const modelChild = { reaped: true, exit: { code: 0, signal: null }, close: { code: 0, signal: null }, failures: [], signals: [] };
test('B1-valid-control', () => assert.equal(qualify(specimens.get('W02'), modelReport(specimens.get('W02')), modelChild, true, 'virtual-bash').pass, true));
for (const [id, mutate] of [
  ['B1-missing-late', report => { delete report.late; }],
  ['B1-nonempty-late', report => { report.late = [{ name: 'Error', message: 'independent rejected continuation' }]; }],
  ['B1-denied-load', report => { report.loads.denied = [{ code: 'RETURNED_SOURCE_HASH' }]; }],
  ['B1-missing-postguard', report => { delete report.postGuard; }],
  ['B1-contradictory-result', report => { report.executionError = null; }]
]) test(id, () => {
  const report = modelReport(specimens.get('W02')); mutate(report);
  const outcome = qualify(specimens.get('W02'), report, modelChild, true, 'virtual-bash');
  assert.deepEqual(outcome, { safe: false, pass: false, status: 'UNSAFE_STOP' });
  details[id] = { report, outcome, standaloneNotComposedBypass: true };
});
test('W07-uncredited-and-exact-failures', () => {
  const specimen = specimens.get('W07'); const report = modelReport(specimen);
  report.additionalObservations['No fixture executable is executed'] = false;
  const result = qualify(specimen, report, modelChild, true, 'just-bash');
  assert.equal(result.status, 'UNQUALIFIED_UNCREDITED'); assert.equal(result.pass, null);
  assert.equal(result.semanticCredit, false); assert.equal(result.nonExecutionCredit, false); assert.equal(result.assessment.matchingBytesOnly, true);
  assert(result.assessment.checks.some(check => check.id === 'OBSERVATION:No fixture executable is executed' && check.pass === false));
  assert.equal(assessWorkflow(specimen, report, 'virtual-bash').pass, false);
  for (const mutate of [value => { value.result.exitCode = 4; }, value => { value.result.stdoutBase64 += 'AA=='; }, value => { value.result.stderrBase64 = 'Cg=='; }, value => { value.after.entries.push({ path: '/fixture/extra', type: 'file', base64: '' }); }]) {
    const changed = structuredClone(report); mutate(changed);
    const rejected = assessWorkflow(specimen, changed, 'just-bash'); assert.equal(rejected.pass, false); assert.equal(rejected.status, 'FAILED');
  }
  details.W07 = result;
});
const node = freeze.tools.find(tool => tool.role === 'node').path;
const ordinaryLedger = createLedger(4); ledgers.push({ name: 'outcomes', ledger: ordinaryLedger });
async function launchFixture(mode, ledger, persistName) {
  assert(safeToLaunch, 'Earlier child failed safety; no further launches');
  try {
    return await launchTracked({ ledger, kind: 'independent-static-fixture', prepare: async entry => {
      assert.equal(entry.state, 'ENROLLED'); assert.equal(entry.launchAttempted, false);
      return { configSha: save(`config-${children.length + 1}.json`, { mode, node, heapMiB: 64, deadlineMs: 5000 }) };
    }, supervise: async (_prepared, attach) => {
      const receipt = await supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=64', path.join(own, 'child.mjs'), mode], output, { deadline: 5000, onSpawn: (handle, state) => {
        attach(handle, state);
        assert.equal(ledger.entries.at(-1).pid, handle.pid);
        assert.equal(ledger.entries.at(-1).group, -handle.pid);
        assert.equal(ledger.entries.at(-1).state, 'LAUNCHING');
      } });
      children.push(receipt);
      if (!receipt.reaped || !receipt.exit || !receipt.close || receipt.failures.length || receipt.signals.length || receipt.exit.code !== 0 || receipt.close.code !== 0) safeToLaunch = false;
      return receipt;
    }, persist: async (entry, receipt) => {
      assert.equal(entry.pid, receipt.pid); assert.equal(entry.state, 'SUPERVISED'); assert.equal(entry.reaped, true);
      return save(persistName ?? `child-${children.length}.json`, receipt);
    } });
  } catch (error) { if (error.original?.code !== 'EEXIST') safeToLaunch = false; throw error; }
}
let lastLoaded;
for (const [mode, expectedStatus, expectedEffects, expectedPass, expectedSemanticPass] of [
  ['noop', 0, 0, true, false], ['status23', 23, 0, false, false], ['partial-effect', 0, 1, false, false], ['complete-effects', 0, 3, false, true]
]) test(`R3-loaded-${mode}`, async () => {
  const receipt = await launchFixture(mode, ordinaryLedger);
  assert.equal(safeToLaunch, true);
  const observed = receipt.records.at(-1).report;
  assert(observed.execArgv.includes('--unhandled-rejections=strict'));
  const result = assessLoadedNoop(specimens.get('W02'), modelReport(specimens.get('W02')).before, observed, receipt.records);
  assert.equal(result.actualStatus, expectedStatus); assert.equal(Object.keys(result.actualEffects).length, expectedEffects);
  assert.equal(result.pass, expectedPass); assert.equal(result.assessment.pass, expectedSemanticPass);
  assert.equal(result.loadedObservationSha256, observed.observationSha256);
  assert.equal(result.report.result.stdoutBase64, observed.observation.stdoutBase64);
  assert.equal(result.report.after.entries.filter(entry => !modelReport(specimens.get('W02')).before.entries.some(before => before.path === entry.path)).length, expectedEffects);
  lastLoaded = { observed, sources: receipt.records };
  details[`R3-${mode}`] = result;
});
test('R3-source-binding-negative', () => {
  assert(lastLoaded);
  const changed = structuredClone(lastLoaded.observed); changed.entrySha256 = 'f'.repeat(64);
  rejectsCode(() => assessLoadedNoop(specimens.get('W02'), modelReport(specimens.get('W02')).before, changed, lastLoaded.sources), 'C12_LOAD_BINDING');
});
test('R4-EEXIST-emergency-closed-unrun-tail', async () => {
  const ledger = createLedger(2); ledgers.push({ name: 'intentional-EEXIST', ledger });
  save('collision.json', { sentinel: 'must remain untouched' });
  const before = fingerprint(path.join(output, 'collision.json'));
  let tailExecuted = false;
  const result = await serial([{ id: 'persistence' }, { id: 'tail' }], async item => {
    if (item.id === 'tail') { tailExecuted = true; return { safe: true, pass: true }; }
    await launchFixture('noop', ledger, 'collision.json');
    return { safe: true, pass: true };
  }, async () => {});
  save('PERSISTENCE-UNSAFE.json', { result, ledger: ledger.entries, accounting: ledger.summary() });
  assert.equal(result.unsafe, true); assert.equal(tailExecuted, false);
  assert.deepEqual(result.rows.map(row => row.status), ['UNSAFE_STOP', 'UNRUN_UNSAFE_TAIL']);
  assert.equal(result.rows[0].error.original.code, 'EEXIST');
  assert.equal(ledger.entries[0].state, 'UNSAFE_STOP'); assert.equal(ledger.entries[0].persisted, false);
  assert.equal(ledger.entries[0].emergencyReceipt.reaped, true);
  assert.deepEqual(ledger.entries[0].emergencyReceipt.close, { code: 0, signal: null });
  assert.deepEqual(ledger.summary(), { enrolled: 1, attempted: 1, launched: 1, closed: 1, unknownAcquisitions: 0, allChildrenReaped: true, unsafe: true });
  assert.deepEqual(fingerprint(path.join(output, 'collision.json')), before);
  rejectsCode(() => ledger.enroll('forbidden-tail'), 'LAUNCH_LEDGER_BOUND');
});
test('R4-preparation-and-unknown-acquisition', async () => {
  const ledger = createLedger(1);
  await assert.rejects(launchTracked({ ledger, kind: 'prepare-failure', prepare: async () => { throw Object.assign(new Error('independent config persistence'), { code: 'EIO' }); }, supervise: async () => { throw new Error('must not launch'); }, persist: async () => { throw new Error('must not persist'); } }), error => error.code === 'LAUNCH_UNSAFE');
  assert.equal(ledger.summary().attempted, 0); assert.equal(ledger.summary().allChildrenReaped, null); assert.equal(ledger.summary().unsafe, true);
  const unknown = createLedger(1); const entry = unknown.enroll('unknown'); unknown.starting(entry); unknown.failed(entry, 'supervise', new Error('no pid'));
  assert.equal(unknown.summary().unknownAcquisitions, 1); assert.equal(unknown.summary().allChildrenReaped, false);
  details.R4Models = { beforeSpawnFailure: ledger.entries, unknownAcquisition: unknown.entries, noRealChild: true };
});
assert.deepEqual(tests.map(row => row.id), [...expected.DATA, ...expected.SYNTHETIC]);
try {
  for (const control of tests) {
    try { await control.action(); rows.push({ id: control.id, kind: expected.DATA.includes(control.id) ? 'DATA' : 'SYNTHETIC', pass: true }); }
    catch (error) { rows.push({ id: control.id, kind: expected.DATA.includes(control.id) ? 'DATA' : 'SYNTHETIC', pass: false, error: errorRecord(error) }); }
  }
} finally {
  clearTimeout(watchdog);
  for (const { ledger } of ledgers) for (const entry of ledger.entries) if (entry.pid && !entry.reaped) await ledger.emergency(entry);
}
await delay(50);
const activeOwnedHandles = process._getActiveHandles().filter(handle => handle.constructor?.name === 'ChildProcess').map(handle => ({ pid: handle.pid, exitCode: handle.exitCode, signalCode: handle.signalCode }));
const absence = children.map(receipt => ({ pid: receipt.pid, pidAbsent: absent(receipt.pid), groupAbsent: absent(-receipt.pid) }));
function absent(identifier) { assert(Number.isInteger(identifier) && identifier !== 0); try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }
const finalBindings = verify(freeze);
const outcome = { schema: 'independent-v4-focused-result', presealCommit, recipeSha256: freeze.recipeSha256, rows, counts: { pass: rows.filter(row => row.pass).length, failed: rows.filter(row => !row.pass).length, total: rows.length, DATA: rows.filter(row => row.kind === 'DATA').length, SYNTHETIC: rows.filter(row => row.kind === 'SYNTHETIC').length }, children: children.length, ledgers: ledgers.map(({ name, ledger }) => ({ name, entries: ledger.entries, accounting: ledger.summary() })), absence, activeOwnedHandles, details, finalBindings, actualProductImports: 0, actualComparatorImports: 0, actualC11: 0, semanticCalls: 0, noSemanticGo: true };
save('RESULT.json', outcome);
save('FINAL.json', { finished: new Date().toISOString(), ...finalBindings, absence, activeOwnedHandles, gitStatus: git('status', '--porcelain=v1', '--untracked-files=all'), index: git('diff', '--cached', '--name-status'), evidenceBytesBeforeFinal: evidenceBytes });
console.log(JSON.stringify({ counts: outcome.counts, children: children.length, closed: absence.filter(row => row.pidAbsent && row.groupAbsent).length, activeOwnedHandles, presealCommit }));
if (rows.some(row => !row.pass) || children.length !== expected.expectedFixtureChildren || absence.some(row => !row.pidAbsent || !row.groupAbsent) || activeOwnedHandles.length) process.exitCode = 1;
