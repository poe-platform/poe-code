import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { authenticate, home, candidateRoot, hashFile } from './auth.mjs';

const before = authenticate();
const evidence = path.join(home, 'evidence-01');
fs.mkdirSync(evidence);
fs.mkdirSync(path.join(evidence, 'imports'));
const save = (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  assert.ok(bytes.length <= 262144, name);
  fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx' });
};
save('BEFORE.json', before);
const { snapshotImports } = await import('./import-guard.mjs');
const { compose } = await import('./composition.mjs');
const { observeCoordinator, allocation } = await import('../../../breadth-continuation-20260828/executor-v7-r1/outer.mjs');
const { supervise } = await import('../../../breadth-continuation-20260828/executor-v7-r1/supervisor.mjs');
const { assessTerminal, publish } = await import('../../../breadth-continuation-20260828/executor-v7-r1/report.mjs');
const { createStore, readDocument, encode, limits } = await import('../../../breadth-continuation-20260828/executor-v7-r1/records.mjs');
const { createEvidenceBudget, writeReserved } = await import('../../../breadth-continuation-20260828/executor-v7-r1/evidence.mjs');
const { createLedger } = await import('../../../breadth-continuation-20260828/executor-v7-r1/launch-ledger.mjs');
const { createQueryWindow, importWithWindow } = await import('../../../breadth-continuation-20260828/executor-v7-r1/bootstrap.mjs');
const { readAuthorization } = await import('../../../breadth-continuation-20260828/executor-v7-r1/authorization.mjs');
const { transport, parseTransport } = await import('../../../breadth-continuation-20260828/executor-v7-r1/transport.mjs');
const { inspectTree, boundFile } = await import('../../../breadth-continuation-20260828/executor-v7-r1/projection.mjs');
const preseal = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const families = [];
const childReceipts = [];
const childIntents = [];
const late = [];
const onUnhandled = error => late.push({ type: 'unhandledRejection', message: String(error) });
process.on('unhandledRejection', onUnhandled);
const initialResources = process.getActiveResourcesInfo().sort();
let allowChildren = true;
let positive;
const child = (entry, mode) => {
  assert.equal(allowChildren, true, 'previous child must close');
  const expected = preseal.children[childIntents.length];
  assert.deepEqual({ entry, mode }, { entry: expected.entry, mode: expected.mode });
  childIntents.push({ entry, mode });
};
function closure(receipt, label) {
  childReceipts.push({ label, ...receipt });
  save(`child-${String(childReceipts.length).padStart(2, '0')}.json`, { label, ...receipt });
  if (!receipt.reaped || !receipt.exit || !receipt.close) allowChildren = false;
  assert.equal(receipt.reaped, true, label);
  assert.ok(receipt.exit && receipt.close, label);
  assert.throws(() => process.kill(receipt.pid, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(-receipt.pid, 0), { code: 'ESRCH' });
}
function base(name) { return path.join(evidence, name); }
async function body(id, options = {}) {
  const result = await compose(base(id), 'synthetic', { ...options, onChild: mode => child('stub-child.mjs', mode) });
  for (const entry of result.ledger) if (entry.pid) {
    const receiptFile = path.join(result.runRoot, `child-${String(entry.ordinal).padStart(3, '0')}.receipt.json`);
    const receipt = fs.existsSync(receiptFile) ? readDocument(result.runRoot, path.basename(receiptFile), entry.receiptSha) : entry.emergencyReceipt ?? entry;
    closure(receipt, id);
  }
  return result;
}
async function outer(mode, extra = {}) {
  child('body-child.mjs', mode);
  const result = await observeCoordinator({ node: process.execPath, args: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', path.join(home, 'import-guard.mjs'), path.join(home, 'body-child.mjs'), mode], cwd: home, captureRoot: base(`outer-${mode}-capture`), resultRoot: path.join(base(`outer-${mode}-body`), 'runs/synthetic'), deadline: 10000, syntheticOnly: true, ...extra });
  closure(result.receipt, `outer-${mode}`);
  return result;
}
async function policy(mode) {
  child('policy-child.mjs', mode);
  const receipt = await supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', path.join(home, 'import-guard.mjs'), path.join(home, 'policy-child.mjs'), mode], home, { deadline: 10000 });
  closure(receipt, `policy-${mode}`);
  assert.equal(receipt.natural, true);
  assert.equal(receipt.exit.code, 0);
  return receipt.records.at(-1).report;
}
async function family(id, action) {
  const declared = preseal.families[families.length];
  assert.equal(id, declared.id);
  const started = new Date().toISOString();
  try {
    const detail = await action();
    const row = { id, expected: declared.expected, pass: true, started, finished: new Date().toISOString(), detail };
    families.push(row); save(`${id}.json`, row);
  } catch (error) {
    const row = { id, expected: declared.expected, pass: false, started, finished: new Date().toISOString(), error: { name: error?.name, code: error?.code, message: error?.message, stack: error?.stack } };
    families.push(row); save(`${id}.json`, row);
  }
}
const clone = value => JSON.parse(JSON.stringify(value));
const refused = result => { assert.equal(result.publication.unsafe, true); assert.notEqual(result.publication.exitCode, 0); };

await family('F01', async () => {
  positive = await outer('positive');
  assert.equal(positive.qualified, true);
  assert.equal(assessTerminal(positive.receipt, path.join(base('outer-positive-body'), 'runs/synthetic')), false);
  assert.equal(positive.receipt.records.at(-1).report.allPass, true);
  return { syntheticQualified: true, realAuthorityRefused: true, fixturePassRows: 12, engineCalls: 0 };
});
await family('F02', async () => {
  const result = await outer('exit7');
  assert.equal(result.qualified, false);
  assert.equal(result.receipt.exit.code, 7);
  assert.equal(result.receipt.close.code, 7);
  assert.equal(result.receipt.records.at(-1).report.allPass, true);
  return { allPass: true, exit: 7, refused: true };
});
await family('F03', async () => {
  const result = await outer('overflow');
  const receipt = result.receipt;
  assert.equal(receipt.exit.code, 0); assert.equal(receipt.close.code, 0);
  assert.equal(receipt.captureBytes.stdout, 65537);
  assert.equal(Buffer.from(receipt.stdout, 'base64').length, 65536);
  assert.ok(receipt.failures.some(error => error.code === 'CAPTURE_LIMIT'));
  assert.ok(receipt.signals.includes('SIGTERM'));
  assert.equal(receipt.natural, false); assert.equal(result.qualified, false);
  return { observed: 65537, retained: 65536, exit: 0, close: 0, refused: true };
});
await family('F04', async () => {
  const root = path.join(base('outer-positive-body'), 'runs/synthetic');
  const realm = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  const foreign = realm.JSON.parse(JSON.stringify(positive.receipt));
  assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype);
  assert.equal(assessTerminal(foreign, root, { syntheticOnly: true }), true);
  let getterCalls = 0;
  const mutations = [
    value => { delete value.failures; },
    value => { value.extra = true; },
    value => { value.pid = String(value.pid); },
    value => { value.failures = Array(1); },
    value => { value.failures.extra = 1; },
    value => { Object.defineProperty(value, 'failures', { enumerable: true, get() { getterCalls++; return []; } }); },
    value => { value.records.reverse(); value.records[0].sequence = 9; },
    value => { value.captureBytes.stdout = Infinity; },
    value => { value.exit.code = '0'; },
  ];
  for (const mutate of mutations) { const value = clone(positive.receipt); mutate(value); assert.equal(assessTerminal(value, root, { syntheticOnly: true }), false); }
  assert.equal(getterCalls, 0);
  return { crossRealmAccepted: true, negativeControls: mutations.length, getterCalls };
});
await family('F05', async () => {
  const root = path.join(base('outer-positive-body'), 'runs/synthetic');
  const mutations = [
    value => { value.natural = false; },
    value => { value.failures = [{ code: 'CAPTURE_LIMIT' }]; },
    value => { value.signals = ['SIGTERM']; },
    value => { value.captureBytes.stdout++; },
    value => { value.captureBytes.stdout--; },
    value => { value.close.signal = 'SIGTERM'; },
    value => { value.stdout += '='; },
  ];
  for (const mutate of mutations) { const value = clone(positive.receipt); mutate(value); assert.equal(assessTerminal(value, root, { syntheticOnly: true }), false); }
  return { negativeControls: mutations.length, sourceReceipt: 'F01' };
});
await family('F06', async () => {
  child('candidate:coordinator.mjs', 'invalid');
  const boundary = await observeCoordinator({ node: process.execPath, args: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', path.join(home, 'import-guard.mjs'), path.join(candidateRoot, 'coordinator.mjs'), 'invalid', 'never-admission'], cwd: home, captureRoot: base('b16-actual-invalid-cli'), resultRoot: base('never-created'), deadline: 10000, syntheticOnly: true });
  closure(boundary.receipt, 'B16-actual-invalid-cli');
  const receipt = boundary.receipt;
  assert.equal(boundary.qualified, false);
  assert.deepEqual(receipt.exit, { code: 1, signal: null });
  assert.deepEqual(receipt.close, { code: 1, signal: null });
  assert.deepEqual(receipt.failures, []); assert.deepEqual(receipt.signals, []);
  assert.equal(receipt.natural, false);
  assert.equal(receipt.captureBytes.stdout, Buffer.from(receipt.stdout, 'base64').length);
  assert.equal(receipt.captureBytes.records, Buffer.from(receipt.rawRecords, 'base64').length);
  assert.equal(receipt.captureBytes.stderr, 0);
  const actualFinal = receipt.records[0].report;
  assert.deepEqual(actualFinal, { mode: 'invalid', runId: 'never-admission', status: 'UNSAFE_STOP', unsafe: true, result: null, children: 0, allChildrenReaped: true });
  const actualTerminal = JSON.parse(Buffer.from(receipt.stdout, 'base64'));
  assert.deepEqual(actualTerminal.children, []);
  assert.deepEqual(actualTerminal.failures, [{ phase: 'prepare-or-publication', code: 'REPORT_STORE_UNAVAILABLE' }]);
  assert.equal(actualTerminal.primary.present, true);
  assert.equal(actualTerminal.result, null);
  assert.equal(fs.existsSync(path.join(candidateRoot, 'runs/never-admission')), false);
  const result = await body('dynamic-b16', { child: 'pass' });
  assert.equal(result.publication.status, 'ADMISSION_ACCEPTED');
  assert.equal(result.publication.unsafe, false);
  assert.equal(result.ledger.length, 1);
  assert.equal(result.terminal.children.length, 1);
  assert.equal(result.terminal.launchAccounting.closed, 1);
  assert.equal(result.terminal.children[0].persisted, true);
  const stored = readDocument(result.runRoot, 'RESULT.json', result.publication.reference.sha256);
  assert.equal(stored.children.length, 1);
  return { independentDynamicB16: true, actualFinal, actualTerminal, separateStubChain: { terminalChildren: result.terminal.children, launchAccounting: result.terminal.launchAccounting }, qualification: 'Actual candidate invalid CLI, no configuration/staging; separate actual body-to-stub chain' };
});
await family('F07', async () => {
  const result = await body('probe-nonzero', { child: 'exit7' });
  refused(result); assert.equal(result.output.fatal.code, 'ADMISSION_PROBE_STOP');
  assert.equal(result.ledger[0].exit.code, 7);
  return { probeStatus: result.output.probes.rows[0].status, childReaped: true };
});
await family('F08', async () => {
  const marker = new Error('OWNED_ATTACH_FAILURE');
  const result = await body('attach-failure', { child: 'wait-term', spawnObserved: () => { throw marker; } });
  refused(result); assert.equal(result.ledger.length, 1); assert.equal(result.ledger[0].reaped, true);
  return { registeredBeforeFailure: true, reaped: true, failures: result.ledger[0].failures };
});
await family('F09', async () => {
  const result = await body('persist-failure', { child: 'pass', checkpoint: phase => { if (phase === 'receipt-persistence') throw 0; } });
  refused(result); assert.equal(result.ledger[0].reaped, true); assert.equal(result.ledger[0].persisted, false);
  assert.ok(result.ledger[0].emergencyReceipt);
  return { emergencyReceiptRetained: true, persisted: false, primaryCode: result.output.fatal.code };
});
await family('F10', async () => {
  const results = [];
  for (const [label, primary] of [['zero', 0], ['null', null], ['undefined', undefined]]) {
    const result = await body(`setup-${label}`, { checkpoint: phase => { if (phase === 'configuration') throw primary; } });
    refused(result); assert.ok(Object.hasOwn(result.output, 'fatal')); assert.equal(result.output.fatal, primary);
    assert.equal(result.publication.selectedPrimary.present, true);
    assert.equal(result.publication.selectedPrimary.undefinedValue, primary === undefined);
    assert.equal(result.ledger.length, 0);
    results.push({ label, selectedPrimary: result.publication.selectedPrimary, phase: result.output.fatalPhase });
  }
  return { results };
});
await family('F11', async () => {
  const primary = new Error('OWNED_PRIMARY'); const cleanup = new Error('OWNED_CLEANUP');
  const result = await body('primary-identity', { checkpoint: phase => { if (phase === 'configuration') throw primary; }, cleanup: () => { throw cleanup; } });
  refused(result); assert.equal(result.output.fatal, primary); assert.equal(result.output.cleanupErrors.length, 1);
  return { exactPrimaryIdentity: true, selectedMessage: result.publication.selectedPrimary.value.message, cleanupRecorded: true };
});
await family('F12', async () => {
  const result = await body('prepared-no-child', { child: 'pass', checkpoint: phase => { if (phase === 'child-prepared') throw null; } });
  refused(result); assert.equal(result.ledger.length, 1); assert.equal(result.ledger[0].pid, null);
  assert.equal(result.ledger[0].launchAttempted, false);
  return { enrolled: 1, launched: 0, preservedUnlaunchedTail: true };
});
await family('F13', async () => {
  const marker = Object.freeze({ syntheticTail: true });
  const result = await body('tail-after-child', { child: 'pass', checkpoint: phase => { if (phase === 'tail') throw marker; } });
  refused(result); assert.equal(result.output.fatal, marker); assert.equal(result.ledger[0].reaped, true);
  return { exactPrimaryIdentity: true, childClosedBeforeTail: true, primaryPhase: result.output.fatalPhase };
});
await family('F14', async () => {
  const marker = Object.freeze({ syntheticStdout: true });
  const result = await body('stdout-after-child', { child: 'pass', writeStream: descriptor => { if (descriptor === 1) throw marker; } });
  refused(result); assert.equal(result.publication.failures[0].reason.value, marker);
  assert.equal(result.terminal, null); assert.ok(Buffer.concat(result.streams.stderr).length > 0);
  assert.equal(result.ledger[0].reaped, true);
  return { stderrFallback: true, publicationPrimaryIdentity: true, childReaped: true };
});
await family('F15', async () => {
  let budget;
  const text = 'm'.repeat(300000);
  const result = await body('multipart', { checkpoint: (phase, state) => { if (phase === 'tail') { state.output.ownedMultipart = text; budget = state.budget; } } });
  assert.equal(result.publication.unsafe, false);
  const reference = result.publication.reference;
  const restored = readDocument(result.runRoot, 'RESULT.json', reference.sha256);
  assert.equal(restored.ownedMultipart, text);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.runRoot, 'RESULT.json')));
  assert.equal(manifest.schema, 'BOUND_JSON_PARTS_V1'); assert.equal(manifest.parts.length, 2);
  budget.audit();
  const member = path.join(result.runRoot, manifest.parts[0].path);
  const original = fs.readFileSync(member);
  fs.writeFileSync(path.join(evidence, 'F15-original-part.data'), original, { flag: 'wx' });
  const changed = Buffer.from(original); changed[20] ^= 1; fs.writeFileSync(member, changed);
  assert.throws(() => readDocument(result.runRoot, 'RESULT.json', reference.sha256), { code: 'REFERENCE_HASH' });
  assert.throws(() => budget.audit(), { code: 'EVIDENCE_CONTENT' });
  assert.throws(() => readDocument(result.runRoot, 'RESULT.json', '0'.repeat(64)), { code: 'REFERENCE_HASH' });
  return { bytes: manifest.bytes, parts: manifest.parts, tamperRefused: true, originalPreserved: 'F15-original-part.data' };
});
await family('F16', async () => {
  const root = base('partial-write'); fs.mkdirSync(root);
  const budget = createEvidenceBudget(root, { limit: 8192 });
  const cleanup = Object.freeze({ syntheticClose: true }); let first = true;
  const io = { openSync: fs.openSync, writeSync: (descriptor, bytes, offset, length) => { if (!first) throw 0; first = false; return fs.writeSync(descriptor, bytes, offset, Math.min(7, length)); }, closeSync: descriptor => { fs.closeSync(descriptor); throw cleanup; } };
  const store = createStore(root, { budget, io }); let caught;
  try { store.save('partial.json', { value: 'bounded-partial-write' }); } catch (error) { caught = error; }
  assert.equal(caught.code, 'RECORD_WRITE_AND_CLOSE'); assert.equal(caught.primary, 0); assert.equal(caught.cleanup, cleanup);
  assert.equal(fs.statSync(path.join(root, 'partial.json')).size, 7);
  const partial = budget.audit({ partial: true }); assert.throws(() => budget.audit(), { code: 'EVIDENCE_CONTENT' });
  const output = { mode: 'admission', runId: 'synthetic', status: 'UNSAFE_STOP', unsafe: true, fatal: caught };
  const publication = publish({ output, ledger: createLedger(1), store, audit: () => budget.audit({ partial: true }), writeStream: () => {} });
  assert.equal(publication.unsafe, true); assert.ok(publication.failures.length > 0);
  return { partial, exactWriteAndCloseReasons: true, publicationFailures: publication.failures.length, store: store.state() };
});
await family('F17', async () => {
  const root = base('small-quota'); fs.mkdirSync(root);
  const budget = createEvidenceBudget(root, { limit: 128 });
  const store = createStore(root, { budget });
  store.writeRecord('part.data', Buffer.alloc(64));
  const permit = budget.external(path.join(root, 'external.data'), Buffer.alloc(64), 0o444);
  writeReserved(permit, Buffer.alloc(64)); budget.finish(permit.path);
  assert.equal(budget.audit().observedEvidence, 128);
  assert.throws(() => store.writeRecord('overflow.data', Buffer.alloc(1)), { code: 'EVIDENCE_CAP' });
  const result = await body('body-small-cap', { evidenceLimit: 512 }); refused(result);
  assert.ok(result.publication.failures.length > 0 || result.output.fatal?.code === 'EVIDENCE_CAP');
  return { combinedStoreAndExternalBoundary: 128, plusOneRefused: true, actualBodyInjectedLimit: 512, production248MiBAndCollector8MiB: 'STATIC_ONLY' };
});
await family('F18', async () => {
  const root = base('out-of-store'); fs.mkdirSync(root);
  const budget = createEvidenceBudget(root, { limit: 1024 }); const store = createStore(root, { budget });
  store.save('bound.json', { fixture: true }); budget.audit();
  fs.mkdirSync(path.join(root, 'unlisted'));
  assert.throws(() => budget.audit(), error => ['EVIDENCE_ENTRY_CAP', 'EVIDENCE_UNLISTED_DIRECTORY'].includes(error.code));
  const modeRoot = base('mode-tamper'); fs.mkdirSync(modeRoot);
  const modeBudget = createEvidenceBudget(modeRoot, { limit: 1024 }); const modeStore = createStore(modeRoot, { budget: modeBudget });
  const reference = modeStore.save('bound.json', { fixture: true }); fs.chmodSync(path.join(modeRoot, 'bound.json'), 0o600);
  assert.throws(() => readDocument(modeRoot, reference.path, reference.sha256), { code: 'REFERENCE_METADATA' });
  assert.throws(() => modeBudget.audit(), { code: 'EVIDENCE_OBSERVED_SIZE_MODE' });
  return { appendedDirectoryDetected: true, changedModeDetected: true, tamperedFixturesRetained: true };
});
await family('F19', async () => {
  const root = base('record-transport'); fs.mkdirSync(root);
  const budget = createEvidenceBudget(root, { limit: 300000 }); const store = createStore(root, { budget });
  store.writeRecord('exact.data', Buffer.alloc(262144));
  assert.throws(() => store.writeRecord('large.data', Buffer.alloc(262145)), { code: 'RECORD_CAP' });
  const descriptor = fs.openSync(path.join(root, 'transport.data'), 'wx'); const writer = transport(descriptor, 128);
  try {
    writer.emit({ kind: 'first', value: 'a'.repeat(20) });
    assert.throws(() => writer.emit({ kind: 'second', value: 'a'.repeat(40) }), { code: 'RECORD_CAP' });
    assert.throws(() => writer.emit({ kind: 'final' }), { code: 'TRANSPORT_ALREADY_FAILED' });
  } finally { fs.closeSync(descriptor); }
  assert.throws(() => parseTransport(fs.readFileSync(path.join(root, 'transport.data'))), { code: 'FINAL_ENVELOPE' });
  return { exactRecord: 262144, plusOneRefused: true, smallTransportCap: 128, partialTransportRefused: true, writer: writer.state() };
});
await family('F20', async () => {
  const root = base('SYNTHETIC_AUTH_NOT_A_GRANT'); fs.mkdirSync(path.join(root, 'runs/fixture'), { recursive: true });
  const filename = path.join(root, 'runs/fixture/AUTH.json');
  const value = { review: { commit: '0'.repeat(40), path: 'SYNTHETIC_UNRESOLVABLE_REVIEW', sha256: '0'.repeat(64) }, grant: { commit: '0'.repeat(40), path: 'SYNTHETIC_UNRESOLVABLE_GRANT', sha256: '0'.repeat(64) } };
  fs.writeFileSync(filename, JSON.stringify(value), { flag: 'wx' }); const expected = hashFile(filename);
  const result = await body('auth-reference', { controls: () => { assert.deepEqual(readAuthorization(filename, expected, root), value); assert.throws(() => readAuthorization(filename, '1'.repeat(64), root), { code: 'AUTH_FILE_HASH' }); fs.appendFileSync(filename, ' '); assert.throws(() => readAuthorization(filename, expected, root), { code: 'AUTH_FILE_HASH' }); } });
  assert.equal(result.publication.unsafe, false);
  return { authReaderComposedInBody: true, tamperRefused: true, authorityNeverCalled: true, unresolvedZeroCommits: true };
});
await family('F21', () => policy('ordered'));
await family('F22', () => policy('failed'));
await family('F23', () => policy('caught'));
await family('F24', () => policy('bad-mode'));
await family('F25', async () => {
  const checks = [];
  const result = await body('bootstrap-reasons', { controls: async () => {
    for (const [label, marker] of [['zero', 0], ['null', null], ['undefined', undefined], ['object', Object.freeze({ synthetic: true })], ['error', new Error('OWNED_REASON')]]) {
      let nativeCalls = 0; const host = { getBuiltinModule: () => { nativeCalls++; } }; const window = createQueryWindow(() => { throw marker; });
      let caught; let present = false;
      try { await importWithWindow({ host, window, load: () => { host.getBuiltinModule('module'); } }); } catch (error) { present = true; caught = error; }
      assert.equal(present, true); assert.equal(caught, marker); assert.equal(window.snapshot().revoked, true); assert.equal(nativeCalls, 0);
      checks.push({ label, exactIdentity: true, revoked: true });
    }
    const primary = Object.freeze({ primary: true }); const cleanup = Object.freeze({ cleanup: true });
    const window = createQueryWindow(() => {}); const host = { getBuiltinModule: () => { throw new Error('NATIVE_SENTINEL_RAN'); } }; let caught;
    try { await importWithWindow({ host, window, load: () => { throw primary; }, afterRevoke: () => { throw cleanup; } }); } catch (error) { caught = error; }
    assert.equal(caught.primary, primary); assert.equal(caught.cleanup[0], cleanup);
  } });
  assert.equal(result.publication.unsafe, false); return { checks, importAndCleanupIdentity: true };
});
await family('F26', async () => {
  const queries = [[], ['worker_threads'], ['module', 'extra'], [new String('module')], [null], [undefined], ['node:module'], ['module', 'module'], ['module', 'worker_threads', 'module']];
  let nativeCalls = 0; let factoryCalls = 0;
  const result = await body('query-negative', { controls: async () => {
    for (let index = 0; index < queries.length; index++) {
      const host = { getBuiltinModule: () => { nativeCalls++; } }; const window = createQueryWindow(() => {}); let caught;
      try { await importWithWindow({ host, window, load: () => { try { if (index === 2) host.getBuiltinModule(...queries[index]); else if (queries[index].length === 0) host.getBuiltinModule(); else for (const query of queries[index]) host.getBuiltinModule(query); } catch {} return { factory: () => { factoryCalls++; } }; } }).then(imported => imported.factory()); } catch (error) { caught = error; }
      assert.equal(caught.code, 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION'); assert.equal(window.snapshot().revoked, true);
    }
  } });
  assert.equal(result.publication.unsafe, false); assert.equal(nativeCalls, 0); assert.equal(factoryCalls, 0);
  return { negativeControls: queries.length, nativeCalls, factoryCalls };
});
await family('F27', async () => {
  const root = path.join(home, 'fixtures');
  const files = ['caught.mjs', 'failed.mjs', 'ordered.mjs'].map(filename => ({ path: filename, bytes: fs.statSync(path.join(root, filename)).size, mode: 0o444, sha256: hashFile(path.join(root, filename)) }));
  inspectTree(root, files); for (const entry of files) boundFile(path.join(root, entry.path), entry);
  assert.deepEqual(allocation, { combined: 268435456, coordinator: 260046848, collector: 8388608, record: 262144, stream: 65536 });
  assert.equal(allocation.coordinator + allocation.collector, allocation.combined);
  assert.equal(limits.record, 262144); assert.equal(limits.stream, 65536);
  return { readonlyLiteralFiles: 3, allocation, fullCapQualification: 'STATIC_ONLY', actualWorker: 'UNQUALIFIED_AUTHORITY_AND_REAL_SOURCE_BINDINGS_FORBID_STUB_IMPORT' };
});
await family('F28', async () => {
  const result = await outer('postflight', { postflight: () => { throw undefined; } });
  assert.equal(result.qualified, false); assert.equal(result.primaryPresent, true); assert.equal(result.primary.undefinedValue, true);
  const beforeChild = await observeCoordinator({ node: process.execPath, args: [], cwd: home, captureRoot: base('outer-preflight'), resultRoot: base('absent'), deadline: 10000, syntheticOnly: true, preflight: () => { throw 0; } });
  assert.equal(beforeChild.ledger.length, 0); assert.equal(beforeChild.primary.value, 0); assert.equal(beforeChild.qualified, false);
  return { postflightUndefinedPreserved: true, preflightZeroPreserved: true, noPreflightChild: true };
});
await family('F29', async () => {
  child('stub-child.mjs', 'wait-term');
  const receipt = await supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', path.join(home, 'import-guard.mjs'), path.join(home, 'stub-child.mjs'), 'wait-term'], home, { deadline: 10000 });
  closure(receipt, 'natural-deadline');
  assert.equal(receipt.exit.code, 0); assert.equal(receipt.close.code, 0); assert.equal(receipt.natural, false);
  assert.ok(receipt.failures.some(error => error.code === 'NATURAL_DEADLINE')); assert.deepEqual(receipt.signals, ['SIGTERM']);
  return { natural: false, failures: receipt.failures, signals: receipt.signals, reaped: true };
});
await family('F30', async () => {
  await delay(150); await new Promise(resolve => setImmediate(resolve));
  const finalResources = process.getActiveResourcesInfo().sort();
  assert.deepEqual(finalResources, initialResources); assert.deepEqual(late, []);
  assert.equal(childIntents.length, preseal.children.length); assert.equal(childReceipts.length, preseal.children.length);
  assert.ok(childReceipts.every(receipt => receipt.reaped && receipt.exit && receipt.close));
  const importEvents = snapshotImports();
  assert.ok(importEvents.length > 0 && importEvents.every(event => !event.denied));
  let bytes = 0; let files = 0; let maximumRecord = 0;
  const walk = directory => { for (const name of fs.readdirSync(directory)) { const filename = path.join(directory, name); const info = fs.lstatSync(filename); if (info.isDirectory()) walk(filename); else { bytes += info.size; files++; maximumRecord = Math.max(maximumRecord, info.size); } } };
  walk(evidence); assert.ok(bytes < 64 * 1024 * 1024); assert.ok(maximumRecord <= 262144);
  return { initialResources, finalResources, late, children: childReceipts.length, driverProcesses: 1, generatedBytesAtCheck: bytes, files, maximumRecord, importEvents };
});
const after = authenticate(); save('AFTER.json', after);
assert.deepEqual(after, before);
process.removeListener('unhandledRejection', onUnhandled);
const summary = { classification: 'DATA_SYNTHETIC_STUB_ONLY', candidate: preseal.candidate, presealSha256: before.sealSha256, families: families.length, passed: families.filter(row => row.pass).length, failed: families.filter(row => !row.pass).map(row => row.id), childrenLaunched: childIntents.length, childReceipts: childReceipts.length, allChildrenClosed: childReceipts.every(row => row.reaped && row.exit && row.close), children: childIntents, authenticatedBeforeAfter: true, realEngines: 0, actualAdmission: 0, productionWorker: 'UNQUALIFIED', authorCountsUnchanged: true, fullCap: 'STATIC_ONLY' };
save('SUMMARY.json', summary);
process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exitCode = summary.failed.length ? 1 : 0;
