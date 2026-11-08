import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { authenticate } from './guard.mjs';
import { runCoordinator } from '../../../breadth-continuation-20260828/executor-v7-r2/body.mjs';
import { observeCoordinator } from '../../../breadth-continuation-20260828/executor-v7-r2/outer.mjs';
import { supervise } from '../../../breadth-continuation-20260828/executor-v7-r2/supervisor.mjs';
import { readAuthorization, authority, loadAuthorityReference } from '../../../breadth-continuation-20260828/executor-v7-r2/authorization.mjs';
import { dispositionData, childLedgerData, referenceData, grantData } from '../../../breadth-continuation-20260828/executor-v7-r2/contracts.mjs';
import { createStore, saveInput, readConfig, readDocument, encode, digest } from '../../../breadth-continuation-20260828/executor-v7-r2/records.mjs';
import { transport, parseTransport } from '../../../breadth-continuation-20260828/executor-v7-r2/transport.mjs';
import { createEvidenceBudget } from '../../../breadth-continuation-20260828/executor-v7-r2/evidence.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(home, 'evidence-01');
const matrix = JSON.parse(fs.readFileSync(path.join(home, 'MATRIX.json')));
assert.equal(fs.existsSync(evidence), false);
fs.mkdirSync(evidence);
for (const name of ['dispatch', 'receipts', 'families', 'wire', 'imports']) fs.mkdirSync(path.join(evidence, name));
const before = authenticate();
const startedAt = new Date().toISOString();
const baselineResources = process.getActiveResourcesInfo();
const used = new Set(), children = [], rows = [], metadata = [];
let checks = 0, unsafe = false, seed;
const check = (value, message) => { checks++; assert(value, message); };
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const clone = value => structuredClone(value);
const absent = identifier => {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
};
const errorView = error => ({ type: typeof error, undefinedValue: error === undefined, code: error?.code ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null });
function save(filename, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  check(bytes.length <= 262144, 'OWN_RECORD_BOUND');
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
  return { path: filename, bytes: bytes.length, sha256: digest(bytes) };
}
function expectThrow(action, code) {
  let thrown = false, reason;
  try { action(); } catch (error) { thrown = true; reason = error; }
  check(thrown, `EXPECTED_THROW:${code}`);
  if (code !== undefined) equal(reason?.code, code);
  return reason;
}
function recipe(identifier) {
  check(!used.has(identifier), `NO_RETRY:${identifier}`);
  check(used.size < 19, 'CHILD_PROCESS_BOUND');
  const entry = matrix.children.find(row => row.id === identifier);
  check(entry, `STATIC_RECIPE:${identifier}`);
  used.add(identifier);
  return entry;
}
function closure(identifier, receipt) {
  check(receipt.pid > 0 && receipt.reaped && receipt.exit && receipt.close, 'KNOWN_CLOSURE');
  check(absent(receipt.pid) && absent(-receipt.pid), 'EXACT_PID_GROUP_ABSENT');
  for (const amount of Object.values(receipt.captureBytes)) check(amount <= 65536, 'STREAM_64K');
  const witness = JSON.parse(fs.readFileSync(path.join(evidence, 'imports', `${receipt.pid}.json`)));
  equal(witness.denied, []); equal(witness.late, []);
  check(witness.events.length > 0, 'ACTUAL_LOADED_BODIES');
  const reference = save(path.join(evidence, 'receipts', `${identifier}.json`), receipt);
  children.push({ identifier, pid: receipt.pid, exit: receipt.exit, close: receipt.close, reaped: receipt.reaped, natural: receipt.natural, signals: receipt.signals, failures: receipt.failures, captureBytes: receipt.captureBytes, loads: witness.events.length, receipt: reference });
  return receipt;
}
async function child(identifier, onSpawn) {
  const entry = recipe(identifier);
  const receipt = await supervise(entry.node, entry.args, entry.cwd, { deadline: 10000, onSpawn });
  return closure(identifier, receipt);
}
async function family(identifier, action) {
  const initial = checks;
  if (unsafe) { rows.push({ identifier, status: 'UNRUN_UNSAFE_STOP' }); return; }
  let observation, failure;
  try { authenticate(); observation = await action(); }
  catch (error) { failure = errorView(error); }
  try {
    authenticate();
    for (const entry of children) check(absent(entry.pid) && absent(-entry.pid), 'POST_FAMILY_CLOSURE');
  } catch (error) { unsafe = true; failure = { ...failure, integrityOrClosure: errorView(error) }; }
  const row = { identifier, status: failure ? 'FAIL' : 'PASS', checks: checks - initial, observation, failure };
  rows.push(row); save(path.join(evidence, 'families', `${identifier}.json`), row);
}

save(path.join(evidence, 'BEFORE.json'), { startedAt, inputs: before, node: process.version, execArgv: process.execArgv, baselineResources, driverPid: process.pid, classification: 'INDEPENDENT_DATA_STUB_NOT_AUTHORITY' });
for (const identifier of ['metadata-review', 'metadata-grant']) {
  const receipt = await child(identifier);
  equal(receipt.exit, { code: 0, signal: null }); equal(receipt.close, receipt.exit);
  equal(receipt.failures, []); equal(receipt.signals, []);
  const stdout = Buffer.from(receipt.stdout, 'base64');
  metadata.push({ reference: { commit: '0'.repeat(40), path: `tests/INERT-INDEPENDENT-${identifier}.json`, sha256: digest(stdout) }, child: { pid: receipt.pid, status: receipt.exit.code, signal: receipt.exit.signal, errorCode: null, stdout, stderr: Buffer.from(receipt.stderr, 'base64'), reaped: receipt.reaped } });
}

await family('F01', async () => {
  const outcomes = [];
  const context = envelope => ({ root: home, repository: home, phase: 'admission', runId: 'never-authority', outputRoot: path.join(home, 'runs/never-authority'), ...envelope, observe() {} });
  for (const identifier of ['A01', 'A02']) {
    const filename = path.join(home, 'inputs/runs', identifier, 'AUTH.json');
    const bytes = fs.readFileSync(filename), parsed = JSON.parse(bytes);
    if (identifier === 'A01') equal(readAuthorization(filename, digest(bytes), path.join(home, 'inputs')), parsed);
    else expectThrow(() => readAuthorization(filename, digest(bytes), path.join(home, 'inputs')), 'AUTH_REFERENCE_SCHEMA');
    const rejected = expectThrow(() => authority(context(parsed)), identifier === 'A01' ? 'AUTH_CONTEXT_SCHEMA' : 'AUTHORIZATION_BINDING');
    if (identifier === 'A02') expectThrow(() => loadAuthorityReference(parsed.review, { read() { throw new Error('UNEXPECTED_READ'); } }), 'AUTHORIZATION_BINDING');
    outcomes.push({ identifier, sha256: digest(bytes), readerAccepted: identifier === 'A01', downstreamCode: rejected.code, sameOriginalJSON: true });
  }
  let getters = 0, coercions = 0, reads = 0, observations = 0;
  const canonical = { review: metadata[0].reference, grant: metadata[1].reference };
  const authRoot = path.join(evidence, 'auth');
  for (const member of ['review', 'grant']) {
    for (const variant of ['array-commit', 'object-commit', 'array-path', 'array-hash', 'extra']) {
      const value = clone(canonical), target = value[member];
      if (variant === 'array-commit') target.commit = [target.commit];
      if (variant === 'object-commit') target.commit = { value: target.commit };
      if (variant === 'array-path') target.path = [target.path];
      if (variant === 'array-hash') target.sha256 = [target.sha256];
      if (variant === 'extra') target.extra = true;
      const directory = path.join(authRoot, 'runs', `${member}-${variant}`); fs.mkdirSync(directory, { recursive: true });
      const saved = save(path.join(directory, 'AUTH.json'), value);
      const parsed = JSON.parse(fs.readFileSync(saved.path));
      expectThrow(() => readAuthorization(saved.path, saved.sha256, authRoot), 'AUTH_REFERENCE_SCHEMA');
      expectThrow(() => authority(context(parsed)), 'AUTHORIZATION_BINDING');
      expectThrow(() => loadAuthorityReference(parsed[member], { read() { reads++; }, observe() { observations++; }, receipts: [], ordinal: 1, syntheticOnly: true }), 'AUTHORIZATION_BINDING');
      outcomes.push({ member, variant, sha256: saved.sha256, reader: 'AUTH_REFERENCE_SCHEMA', downstream: 'AUTHORIZATION_BINDING', helper: 'AUTHORIZATION_BINDING' });
    }
    for (const variant of ['getter', 'coercible', 'hole', 'array-extra', 'inherited-required']) {
      let target = clone(canonical[member]);
      if (variant === 'getter') Object.defineProperty(target, 'commit', { enumerable: true, get() { getters++; return '0'.repeat(40); } });
      if (variant === 'coercible') target.commit = { toString() { coercions++; return '0'.repeat(40); } };
      if (variant === 'hole') target.commit = Array(1);
      if (variant === 'array-extra') { target.commit = [target.commit]; target.commit.extra = true; }
      if (variant === 'inherited-required') target = Object.assign(Object.create({ commit: target.commit }), { path: target.path, sha256: target.sha256 });
      expectThrow(() => authority(context({ ...canonical, [member]: target })), 'AUTHORIZATION_BINDING');
      expectThrow(() => loadAuthorityReference(target, { read() { reads++; }, observe() { observations++; }, receipts: [], ordinal: 1, syntheticOnly: true }), 'AUTHORIZATION_BINDING');
    }
  }
  for (const realm of ['local', 'foreign', 'null-prototype']) {
    const source = metadata[0].reference;
    const value = realm === 'foreign' ? vm.runInNewContext(`(${JSON.stringify(source)})`) : realm === 'null-prototype' ? Object.assign(Object.create(null), source) : source;
    check(referenceData(value), 'PRIMITIVE_OWN_DATA_ACCEPTED');
    const receipts = [];
    const document = loadAuthorityReference(value, { read() { return metadata[0].child; }, observe() {}, receipts, ordinal: 1, syntheticOnly: true });
    equal(document, { fixture: 'independent-inert-review' }); equal(receipts.length, 1);
  }
  const inertGrantData = { role: 'root', phase: 'admission', attempts: 1, runId: 'inert-data', outputRoot: '/INERT-NOT-A-GRANT', recipeSha256: '0'.repeat(64), reviewSha256: '0'.repeat(64), planSha256: '0'.repeat(64), bootstrapProfile: 'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1', reportProtocol: 'BOUNDED_TERMINAL_V3', candidate: '0'.repeat(40), packSha256: '0'.repeat(64), command: { entry: 'coordinator.mjs', phase: 'admission', runId: 'inert-data', nodeArgs: ['--unhandled-rejections=strict', '--max-old-space-size=256'] } };
  check(grantData(vm.runInNewContext(`(${JSON.stringify(inertGrantData)})`)), 'CROSS_REALM_DATA_ONLY_SCHEMA');
  for (const variant of ['hole', 'extra', 'getter']) {
    const value = clone(inertGrantData);
    if (variant === 'hole') delete value.command.nodeArgs[0];
    if (variant === 'extra') value.command.nodeArgs.extra = true;
    if (variant === 'getter') Object.defineProperty(value.command.nodeArgs, '0', { enumerable: true, get() { getters++; return '--unhandled-rejections=strict'; } });
    equal(grantData(value), null);
  }
  equal({ getters, coercions, reads, observations }, { getters: 0, coercions: 0, reads: 0, observations: 0 });
  return { outcomes, getters, coercions, invalidReads: reads, invalidObservations: observations, realAuthorityCalls: 0, schemaOnlyInertGrantNotPersisted: true };
});

await family('F02', async () => {
  const directory = path.join(evidence, 'configs'); fs.mkdirSync(directory);
  const store = createStore(directory, { budget: createEvidenceBudget(directory, { limit: 8 * 1024 * 1024 }) }), dispatch = [];
  for (const size of [2097150, 2097151, 2097152]) {
    const value = 'x'.repeat(size - 3);
    equal(encode(value).length, size, 'LF_INCLUDED');
    const name = `child-${String(dispatch.length + 1).padStart(3, '0')}.json`;
    const beforeWrites = store.state().writes.length;
    let reference;
    if (size === 2097152) {
      expectThrow(() => saveInput(store, name, value), 'DOCUMENT_CAP');
      equal(store.state().writes.length, beforeWrites, 'WRITER_REJECTS_BEFORE_WRITE');
      reference = store.save(name, value);
    } else reference = saveInput(store, name, value);
    const expectedError = size === 2097152 ? 'REFERENCE_DOCUMENT' : null;
    if (expectedError) expectThrow(() => readConfig(directory, name, reference.sha256), expectedError);
    else equal(readConfig(directory, name, reference.sha256), value);
    dispatch.push({ root: directory, name, sha256: reference.sha256, length: value.length, bytes: size, expectedError, overFixtureGenericStore: size === 2097152 });
  }
  save(path.join(evidence, 'dispatch/config.json'), dispatch);
  const receipts = [];
  for (const identifier of ['reader-engine-shared', 'reader-control-shared']) {
    const receipt = await child(identifier); equal(receipt.exit, { code: 0, signal: null }); equal(receipt.failures, []);
    equal(receipt.records.at(-1).report.rows.map(row => row.accepted), [true, true, false]); receipts.push(receipt.records.at(-1).report);
  }
  return { dispatch, receipts, wholeProductionReaders: 'UNEXECUTED_SHARED_EXPORTED_READER_ONLY' };
});

async function compose(identifier, options = {}) {
  const base = path.join(evidence, identifier); fs.mkdirSync(base);
  const recordPath = path.join(evidence, 'wire', `${identifier}.fd3.data`);
  const descriptor = fs.openSync(recordPath, 'wx', 0o644), writer = transport(descriptor, 65536);
  const streams = { stdout: [], stderr: [] }, phases = [];
  const operations = options.worker ? [{ id: 'independent-probe', ordinal: 1, kind: 'probe' }, ...(options.status ? [{ id: 'C09-status', ordinal: 2, kind: 'control' }] : [])] : [];
  const refs = { review: metadata[0].reference, grant: metadata[1].reference };
  const recipeHash = before.sealSha256;
  const drivers = {
    evidenceLimit: 8 * 1024 * 1024,
    checkpoint(phase, state) { phases.push(phase); options.checkpoint?.(phase, state); },
    configure() { return { workflows: [], schedule: { rows: [] } }; },
    authorize(context) {
      for (let index = 0; index < 2; index++) loadAuthorityReference(metadata[index].reference, { read() { return metadata[index].child; }, observe(event) { writer.emit(event); }, receipts: context.metadataChildren, ordinal: index + 1, syntheticOnly: true });
      return { synthetic: true, recipe: recipeHash, grant: { fixtureOnly: true }, authorization: { ...refs, syntheticOnly: true, recipe: recipeHash, operations }, metadataChildren: context.metadataChildren, plan: { admission: operations, limits: { admissionSetup: 0 } } };
    },
    integrity() { authenticate(); },
    stageDeclaration() { return { views: [], aliases: [], evidenceFiles: [] }; },
    stage() { return { proof: 'INDEPENDENT_LITERAL_NO_ENGINE', views: options.worker ? { own: { name: 'inert', root: base, files: [] } } : {} }; },
    selectOperation(_permission, config) { return operations.find(row => row.kind === config.kind); },
    async supervise(prepared, synthetic, runRoot, attach) {
      const childId = synthetic ? 'worker-status' : options.worker;
      save(path.join(evidence, 'dispatch', `${childId}.json`), { root: runRoot, name: prepared.filename, sha256: prepared.configSha });
      return child(childId, attach);
    },
    spawnObserved() {}, defectControls() { return []; },
    async controls(context) {
      if (options.status) await context.child({ mode: 'nonzero', view: { name: 'inert' } });
      return { unsafe: false, rows: Array.from({ length: 12 }, (_, index) => ({ id: `C${String(index + 1).padStart(2, '0')}`, pass: true, status: 'INDEPENDENT_LITERAL_ONLY', noActualC11: true })) };
    },
    cleanup(context) { options.cleanup?.(context); },
    inheritedExitCode() { return 0; },
    writeStream(destination, bytes) {
      options.writeStream?.(destination, bytes);
      streams[destination === 1 ? 'stdout' : 'stderr'].push(Buffer.from(bytes));
    },
  };
  let result;
  try {
    result = await runCoordinator({ root: base, repository: home, mode: 'admission', runId: 'synthetic' }, drivers);
    writer.emit({ kind: 'final', report: { mode: result.output.mode, runId: result.output.runId, status: result.publication.status, unsafe: result.publication.unsafe, result: result.publication.reference, children: result.ledger.length, allChildrenReaped: result.ledger.every(row => row.reaped && row.exit && row.close) } });
  } finally { fs.closeSync(descriptor); }
  const stdout = Buffer.concat(streams.stdout), stderr = Buffer.concat(streams.stderr), raw = fs.readFileSync(recordPath);
  check(stdout.length <= 65536 && stderr.length <= 65536 && raw.length <= 65536, 'COMPOSED_STREAM_BOUND');
  const root = path.join(base, 'runs/synthetic');
  return { ...result, root, stdout, stderr, raw, records: parseTransport(raw), phases, artifact: result.publication.reference ? readDocument(root, 'RESULT.json', result.publication.reference.sha256) : null };
}

await family('F03', async () => {
  seed = await compose('seed', { worker: 'worker-zero', status: true });
  equal(seed.publication.status, 'ADMISSION_ACCEPTED'); equal(seed.publication.unsafe, false);
  equal(seed.ledger.length, 2); equal(seed.ledger.map(row => row.exit.code), [0, 7]);
  equal(seed.ledger.map(row => row.natural), [true, false]);
  equal(seed.records.map(row => row.kind), ['authority-observed', 'authority-observed', 'final']);
  equal(seed.artifact.authorizationMetadata.map(row => row.role), ['synthetic-authority-metadata', 'synthetic-authority-metadata']);
  return { root: seed.root, publication: seed.publication, actualLedger: seed.ledger, fd3Sha256: digest(seed.raw), terminalSha256: digest(seed.stdout), qualifications: 'LITERAL_DRIVER_CONTROLS_NOT_PRODUCTION_ADMISSION' };
});

await family('F04', async () => {
  check(seed?.artifact, 'SEED_PREREQUISITE');
  const results = [];
  for (const value of [{ code: 0, signal: null }, { code: 255, signal: null }, { code: null, signal: 'SIGTERM' }]) {
    check(dispositionData(value)); check(dispositionData(vm.runInNewContext(`(${JSON.stringify(value)})`)));
  }
  for (const code of ['0', false, true, NaN, Infinity, -Infinity, -1, 256, 0.5, undefined, null]) {
    equal(dispositionData({ code, signal: null }), null);
    for (const boundary of ['exit', 'close']) {
      const row = clone(seed.artifact.children[0]); row[boundary] = { code, signal: null };
      equal(childLedgerData(row, 1), null);
    }
    results.push({ type: typeof code, value: String(code), rejectedAtExitAndClose: true });
  }
  for (const signal of [false, true, 0, [], {}, '', 'TERM']) equal(dispositionData({ code: null, signal }), null);
  for (const row of seed.artifact.children) check(childLedgerData(row, row.ordinal), 'ACTUAL_ZERO_STATUS7_ACCEPTED');
  const wrongRole = clone(seed.artifact.children[1]); wrongRole.kind = 'probe'; equal(childLedgerData(wrongRole, 2), null);
  const signalRow = clone(seed.artifact.children[0]); signalRow.exit = signalRow.close = { code: null, signal: 'SIGTERM' }; equal(childLedgerData(signalRow, 1), null);
  let getterCalls = 0;
  const accessor = { signal: null }; Object.defineProperty(accessor, 'code', { enumerable: true, get() { getterCalls++; return 0; } });
  equal(dispositionData(accessor), null); equal(getterCalls, 0);
  return { results, finiteNullableSignalShapeAccepted: true, ordinarySignalTerminationNotSuccess: true, actualStatus7RequiresControl: true, getterCalls };
});

async function replay(identifier, expected) {
  check(seed?.artifact, 'SEED_PREREQUISITE');
  const directory = path.join(evidence, identifier); fs.mkdirSync(directory);
  const store = createStore(directory, { budget: createEvidenceBudget(directory, { limit: 8 * 1024 * 1024 }) }), artifact = clone(seed.artifact), terminal = JSON.parse(seed.stdout), records = clone(seed.records);
  if (identifier === 'metadata-bytes') artifact.authorizationMetadata[0].stdoutBytes++;
  if (identifier === 'child-boolean' || identifier === 'child-string') {
    const code = identifier === 'child-boolean' ? false : '0';
    for (const target of [artifact.children[0], terminal.children[0]]) target.exit = target.close = { code, signal: null };
  }
  if (identifier === 'status-role') artifact.children[1].kind = 'probe';
  const reference = store.save('RESULT.json', artifact);
  terminal.result = reference; records.at(-1).report.result = reference;
  if (identifier === 'final-extra') records.at(-1).report.extra = true;
  if (identifier === 'final-count') records.at(-1).report.children++;
  if (identifier === 'authority-reversed') [records[0], records[1]] = [records[1], records[0]];
  if (identifier === 'authority-repeated') records[1] = clone(records[0]);
  if (identifier === 'authority-absent') records.splice(1, 1);
  records.forEach((row, index) => { row.sequence = index; });
  const stdoutPath = path.join(evidence, 'wire', `${identifier}.stdout.data`);
  const recordsPath = path.join(evidence, 'wire', `${identifier}.fd3.data`);
  fs.writeFileSync(stdoutPath, encode(terminal), { flag: 'wx', mode: 0o644 });
  const descriptor = fs.openSync(recordsPath, 'wx', 0o644);
  try {
    const writer = transport(descriptor, 65536);
    for (const row of records) { const { sequence, ...event } = row; writer.emit(event); }
  } finally { fs.closeSync(descriptor); }
  const raw = fs.readFileSync(recordsPath);
  equal(parseTransport(raw), records, 'AUTHENTICATED_WIRE_NOT_PARSED_OBJECT_ONLY');
  equal(readDocument(directory, 'RESULT.json', reference.sha256), artifact);
  const stdout = fs.readFileSync(stdoutPath);
  save(path.join(evidence, 'dispatch', `${identifier}.json`), { stdout: { path: stdoutPath, sha256: digest(stdout) }, records: { path: recordsPath, sha256: digest(raw) } });
  const entry = recipe(identifier);
  const observed = await observeCoordinator({ node: entry.node, args: entry.args, cwd: entry.cwd, captureRoot: path.join(directory, 'outer'), resultRoot: directory, preflight: authenticate, postflight: authenticate, deadline: 10000, syntheticOnly: true });
  closure(identifier, observed.receipt);
  equal(observed.qualified, expected);
  equal(observed.primaryPresent, !expected);
  equal(observed.receipt.exit, { code: identifier === 'outer-status' ? 7 : 0, signal: null });
  equal(observed.receipt.failures, []); equal(observed.receipt.signals, []);
  equal(observed.receipt.rawRecords, raw.toString('base64'));
  equal(observed.receipt.stdout, stdout.toString('base64'));
  return { identifier, qualified: observed.qualified, primary: observed.primary, resultReference: reference, wireSha256: digest(raw), stdoutSha256: digest(stdout), outerReference: observed.summaryReference, seedPreserved: digest(fs.readFileSync(path.join(seed.root, 'RESULT.json'))) === seed.publication.reference.sha256 };
}

for (const [identifier, variant, expected] of [
  ['F05', 'positive-before', true], ['F06', 'final-extra', false], ['F07', 'final-count', false],
  ['F08', 'authority-reversed', false], ['F09', 'authority-repeated', false], ['F10', 'authority-absent', false],
  ['F11', 'metadata-bytes', false],
]) await family(identifier, () => replay(variant, expected));
await family('F12', async () => ({ twins: [await replay('child-boolean', false), await replay('child-string', false)] }));
await family('F13', () => replay('status-role', false));

await family('F14', async () => {
  const values = [undefined, null, false, 0, ''], outcomes = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const result = await compose(`setup-${index}`, { checkpoint(phase) { if (phase === 'configuration') throw value; } });
    check(Object.hasOwn(result.output, 'fatal')); check(Object.is(result.output.fatal, value), 'FALSY_IDENTITY');
    equal(result.publication.status, 'UNSAFE_STOP'); equal(result.ledger.length, 0);
    equal(result.publication.selectedPrimary.present, true);
    equal(result.publication.selectedPrimary.undefinedValue, value === undefined);
    outcomes.push({ type: typeof value, undefinedValue: value === undefined, selected: result.publication.selectedPrimary, launchAccounting: result.output.launchAccounting });
  }
  const tail = await compose('tail-known-child', { worker: 'worker-tail', checkpoint(phase) { if (phase === 'tail') throw 0; } });
  check(Object.is(tail.output.fatal, 0)); equal(tail.output.fatalPhase, 'tail'); equal(tail.publication.status, 'UNSAFE_STOP');
  equal(tail.ledger.length, 1); check(tail.ledger[0].reaped && tail.ledger[0].exit && tail.ledger[0].close);
  return { setup: outcomes, tail: { primary: tail.publication.selectedPrimary, knownChild: tail.ledger[0], phases: tail.phases } };
});
await family('F15', async () => {
  const sentinel = { marker: 'independent-primary-identity' };
  const result = await compose('report-tail', {
    checkpoint(phase) { if (phase === 'configuration') throw sentinel; },
    cleanup() { throw false; },
    writeStream(destination) { if (destination === 1) throw undefined; },
  });
  check(result.output.fatal === sentinel, 'OBJECT_REASON_IDENTITY');
  equal(result.output.cleanupErrors[0].reason, false);
  equal(result.publication.failures.map(row => row.phase), ['stdout']);
  equal(result.publication.failures[0].reason, { present: true, undefinedValue: true, value: undefined });
  equal(result.stdout.length, 0); check(result.stderr.length > 0);
  equal(result.publication.status, 'UNSAFE_STOP'); equal(result.ledger.length, 0);
  return { identityPreserved: true, primary: result.publication.selectedPrimary, cleanup: result.output.cleanupErrors, publicationFailures: result.publication.failures, stderr: JSON.parse(result.stderr) };
});
await family('F16', async () => ({ positiveTwin: await replay('positive-after', true), outerStatus: await replay('outer-status', false) }));

await nextTurn(); await nextTurn();
const after = authenticate();
equal(after, before, 'BEFORE_AFTER_INPUTS');
const files = [];
function census(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name), info = fs.lstatSync(filename);
    check(!info.isSymbolicLink(), 'OWN_EVIDENCE_NO_SYMLINK');
    if (info.isDirectory()) census(filename);
    else {
      check(info.size <= 262144, 'PHYSICAL_RECORD_CAP');
      files.push({ path: path.relative(home, filename), bytes: info.size, mode: info.mode & 0o7777, sha256: digest(fs.readFileSync(filename)) });
    }
  }
}
census(evidence);
check(files.reduce((total, entry) => total + entry.bytes, 0) < 32 * 1024 * 1024, 'INPUT_EVIDENCE_32M');
equal(rows.map(row => row.identifier), matrix.families.map(row => row.id));
const result = { classification: 'SCOPED_INDEPENDENT_DYNAMIC_NOT_AUTHORITY_ACCEPTANCE', startedAt, finishedAt: new Date().toISOString(), families: rows.length, pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => row.status === 'FAIL').length, unrun: rows.filter(row => row.status.startsWith('UNRUN')).length, checks, unsafe, scheduledChildren: matrix.children.length, actualChildren: children.length, totalNodeProcessesIncludingDriver: children.length + 1, children, rows, before, after, files, rawBytesBeforeFinalRecords: files.reduce((total, entry) => total + entry.bytes, 0), baselineResources, finalResources: process.getActiveResourcesInfo(), full32MiBAnd248Plus8: 'STATIC_ONLY', productionAuthorityAndWholeWorker: 'UNQUALIFIED', actualEngineImports: 0, realAdmission: 0, authorCountsNotClaimed: true };
save(path.join(evidence, 'RESULT.json'), result);
console.log(JSON.stringify({ families: result.families, pass: result.pass, fail: result.fail, unrun: result.unrun, children: children.length, nodeProcessesIncludingDriver: children.length + 1, unsafe }));
process.exitCode = result.fail || result.unrun || unsafe ? 1 : 0;
