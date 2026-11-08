import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { own, author, inherited, url, authenticate, writeJson, absent, sha256 } from './auth.mjs';

const before = authenticate(true);
const { createStore, encode, limits, readDocument } = await import(url(path.join(author, 'records.mjs')));
const { publish, assessTerminal } = await import(url(path.join(author, 'publisher.mjs')));
const { createLedger, launchTracked } = await import(url(path.join(inherited, 'launch-ledger.mjs')));
const { supervise } = await import(url(path.join(inherited, 'supervisor.mjs')));
const run = process.argv[2];
assert.equal(run, path.join(own, 'runs/independent-v1-01'));
const plan = JSON.parse(fs.readFileSync(path.join(own, 'CASES.json')));
const rows = [];
const children = [];
const handles = [];
let generatedInputUpperBound = 1048576;
const text = length => { generatedInputUpperBound += length; assert.ok(generatedInputUpperBound <= 67108864); return 'x'.repeat(length); };
const bytes = length => { generatedInputUpperBound += length; assert.ok(generatedInputUpperBound <= 67108864); return Buffer.alloc(length, 120); };
const folder = (root, name) => { const target = path.join(root, name); fs.mkdirSync(target); return target; };
const error = code => Object.assign(new Error(code), { code });
const reject = (action, code) => assert.throws(action, reason => reason?.code === code);
const base = () => ({ mode: 'admission', runId: 'independent', status: 'ADMISSION_ACCEPTED', unsafe: false, controls: { rows: [{ pass: true }] } });
const capture = () => {
  const channels = { 1: [], 2: [] };
  return { channels, writeStream(descriptor, buffer) { assert.ok(buffer.length <= 32768); channels[descriptor].push(Buffer.from(buffer)); assert.ok(channels[descriptor].reduce((total, chunk) => total + chunk.length, 0) <= 65536); } };
};
const rawReceipt = (stdout, code = 0) => ({ stdout, stderr: Buffer.alloc(0), exit: { code, signal: null }, close: { code, signal: null }, reaped: true });
const decoded = receipt => ({ ...receipt, stdout: Buffer.from(receipt.stdout, 'base64'), stderr: Buffer.from(receipt.stderr, 'base64') });
const observe = (root, value) => writeJson(path.join(root, 'OBSERVATION.json'), value);
async function stub(root, mode, failPersistence = false) {
  const ledger = createLedger(1);
  let receipt;
  let caught;
  try {
    await launchTracked({
      ledger,
      kind: `independent-${mode}`,
      prepare: async () => ({ configSha: sha256(fs.readFileSync(path.join(own, 'stub.mjs'))) }),
      supervise: async (_, attach) => {
        receipt = await supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=128', path.join(own, 'stub.mjs'), mode, root], root, { deadline: 10000, onSpawn(handle, state) { handles.push(handle); attach(handle, state); } });
        children.push({ mode, receipt, exactHandlePid: handles.at(-1).pid, pidAbsent: absent(receipt.pid), groupAbsent: absent(-receipt.pid) });
        return receipt;
      },
      persist: () => { if (failPersistence) throw error('INDEPENDENT_RECEIPT_PERSISTENCE'); return writeJson(path.join(root, 'RECEIPT.json'), receipt).sha256; },
    });
  } catch (reason) { caught = reason; }
  assert.ok(receipt && receipt.exit && receipt.close && receipt.reaped);
  assert.ok(absent(receipt.pid) && absent(-receipt.pid));
  assert.ok(Buffer.from(receipt.stdout, 'base64').length <= 65536);
  assert.ok(Buffer.from(receipt.stderr, 'base64').length <= 65536);
  assert.ok(Buffer.from(receipt.rawRecords, 'base64').length <= 262144);
  return { ledger, receipt, caught };
}

const tests = {
  D01(root) {
    const value = { escaped: '\u0000\n\t"\\é😀\ud800', array: [undefined, NaN, null], absent: undefined };
    const expected = Buffer.from(`${JSON.stringify(value)}\n`);
    assert.deepEqual(encode(value, expected.length), expected);
    reject(() => encode(value, expected.length - 1), 'DOCUMENT_CAP');
    observe(root, { exactBytes: expected.length, oneLessRejected: true });
  },
  D02(root) {
    let invoked = 0;
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked++; return 1; } });
    const cycle = {}; cycle.self = cycle;
    for (const [value, code] of [[cycle, 'SERIALIZATION_CYCLE'], [accessor, 'SERIALIZATION_ACCESSOR'], [{ toJSON() { invoked++; } }, 'SERIALIZATION_TOJSON'], [new Date(0), 'SERIALIZATION_PROTOTYPE'], [1n, 'SERIALIZATION_TYPE'], [undefined, 'SERIALIZATION_UNDEFINED_ROOT']]) reject(() => encode(value, 1024), code);
    assert.equal(invoked, 0);
    observe(root, { refusals: 6, invoked });
  },
  D03(root) {
    let nested = null;
    for (let index = 0; index < 65; index++) nested = { nested };
    reject(() => encode(nested, 4096), 'SERIALIZATION_BOUND');
    const wide = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`key-${index}`, 0]));
    reject(() => encode(wide, 64), 'DOCUMENT_CAP');
    observe(root, { nestedObjects: 65, ownKeys: 1000, smallCap: 64, allocationClaim: 'descriptor enumeration precedes per-node refusal; no unbounded stress attempted' });
  },
  D04(root) {
    const store = createStore(root);
    reject(() => store.save('small.json', text(1024), 1024), 'DOCUMENT_CAP');
    reject(() => store.save('default.json', text(33554433)), 'DOCUMENT_CAP');
    assert.equal(store.state().writes.length, 0);
    assert.equal(store.state().accounted, 0);
    observe(root, { defaultLogicalCharacters: 33554433, acquisitions: 0, generatedInputUpperBound });
  },
  D05(root) {
    const store = createStore(root);
    const accepted = store.writeRecord('exact.data', bytes(262144));
    reject(() => store.writeRecord('oversize.data', bytes(262145)), 'RECORD_CAP');
    assert.equal(accepted.bytes, 262144);
    assert.equal(store.state().accounted, 262144);
    assert.equal(store.state().writes.length, 1);
    observe(root, store.state());
  },
  D06(root) {
    const small = createStore(folder(root, 'small'), { totalLimit: 10 });
    small.writeRecord('first.data', bytes(6));
    reject(() => small.writeRecord('first.data', bytes(4)), 'EEXIST');
    reject(() => small.writeRecord('later.data', bytes(1)), 'EVIDENCE_CAP');
    assert.equal(small.state().accounted, 10);
    assert.equal(small.state().writes[1].complete, false);
    const states = [];
    for (const extra of [2, 3]) {
      const destination = folder(root, `parts-${extra}`);
      const store = createStore(destination, { totalLimit: 262144 + extra });
      reject(() => store.save('quota.json', text(262144)), 'EVIDENCE_CAP');
      assert.ok(!fs.existsSync(path.join(destination, 'quota.json')));
      assert.equal(store.state().accounted, extra === 2 ? 262144 : 262147);
      states.push(store.state());
    }
    observe(root, { small: small.state(), multipart: states });
  },
  D07(root) {
    const observations = [];
    for (const [name, primary] of [['zero', 0], ['null', null], ['undefined', undefined]]) {
      const target = folder(root, name);
      let descriptor;
      let writes = 0;
      const cleanup = error('INDEPENDENT_CLOSE');
      const store = createStore(target, { io: { ...fs, openSync(...args) { descriptor = fs.openSync(...args); return descriptor; }, writeSync(opened, buffer, offset) { if (writes++ === 0) return fs.writeSync(opened, buffer, offset, 2); throw primary; }, closeSync(opened) { fs.closeSync(opened); throw cleanup; } } });
      let caught;
      try { store.writeRecord('partial.data', bytes(8)); } catch (reason) { caught = reason; }
      assert.equal(caught?.code, 'RECORD_WRITE_AND_CLOSE');
      assert.equal(caught.primaryPresent, true);
      assert.equal(caught.primary, primary);
      assert.equal(caught.cleanup, cleanup);
      reject(() => fs.fstatSync(descriptor), 'EBADF');
      assert.equal(fs.statSync(path.join(target, 'partial.data')).size, 2);
      assert.equal(store.state().writes[0].complete, false);
      assert.equal(store.state().accounted, 8);
      observations.push({ name, primaryPresent: caught.primaryPresent, undefinedValue: caught.primary === undefined, primary: caught.primary, cleanup: caught.cleanup.code, state: store.state(), descriptorClosed: true });
    }
    observe(root, observations);
  },
  D08(root) {
    fs.writeFileSync(path.join(root, 'existing.json'), 'sentinel', { flag: 'wx', mode: 0o644 });
    const store = createStore(root);
    reject(() => store.save('existing.json', 'new'), 'EEXIST');
    assert.equal(fs.readFileSync(path.join(root, 'existing.json'), 'utf8'), 'sentinel');
    assert.equal(store.state().accounted, 6);
    observe(root, store.state());
  },
  D09(root) {
    let manifest;
    let attempts = 0;
    const store = createStore(root, { io: { ...fs, openSync(filename, ...args) { const descriptor = fs.openSync(filename, ...args); if (path.basename(filename) === 'RESULT.json') manifest = descriptor; return descriptor; }, writeSync(descriptor, buffer, offset, length) { if (descriptor === manifest) { if (attempts++ === 0) return fs.writeSync(descriptor, buffer, offset, 1); throw error('INDEPENDENT_DESCRIPTOR_WRITE'); } return fs.writeSync(descriptor, buffer, offset, length); }, closeSync(descriptor) { fs.closeSync(descriptor); if (descriptor === manifest) manifest = undefined; } } });
    const sink = capture();
    const outcome = publish({ output: { ...base(), payload: text(300000) }, ledger: createLedger(0), store, writeStream: sink.writeStream });
    assert.equal(outcome.reference, null);
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.status, 'UNSAFE_STOP');
    assert.equal(fs.statSync(path.join(root, 'RESULT.json')).size, 1);
    const partial = fs.readFileSync(path.join(root, 'RESULT.json'));
    assert.throws(() => readDocument(root, 'RESULT.json', sha256(partial)), SyntaxError);
    assert.ok(fs.existsSync(path.join(root, 'PUBLICATION-FAILURE.json')));
    assert.equal(assessTerminal(rawReceipt(Buffer.concat(sink.channels[1]), 1), root), false);
    observe(root, { outcome: { status: outcome.status, exitCode: outcome.exitCode, reference: outcome.reference }, writes: store.state(), descriptorFirstBytes: partial.toString() });
  },
  D10(root) {
    const observations = [];
    for (const [name, primary] of [['zero', 0], ['null', null], ['undefined', undefined]]) {
      const target = folder(root, name);
      const store = createStore(target, { io: { ...fs, openSync() { throw error('INDEPENDENT_OPEN'); } } });
      const sink = capture();
      const outcome = publish({ output: { ...base(), fatal: primary, cleanup: 'later' }, ledger: createLedger(0), store, writeStream(descriptor, buffer) { if (descriptor === 1) throw error('INDEPENDENT_STDOUT'); sink.writeStream(descriptor, buffer); } });
      assert.equal(outcome.primary.present, true);
      assert.equal(outcome.primary.value, primary);
      assert.equal(outcome.primary.undefinedValue, primary === undefined);
      assert.equal(outcome.exitCode, 1);
      assert.equal(outcome.failures.length, 4);
      assert.ok(Buffer.concat(sink.channels[2]).length <= 32768);
      observations.push({ name, primary: outcome.primary, phases: outcome.failures.map(row => row.phase), fallback: JSON.parse(Buffer.concat(sink.channels[2])) });
    }
    observe(root, observations);
  },
  D11(root) {
    const attempts = [];
    const outcome = publish({ output: base(), ledger: createLedger(0), store: createStore(root), writeStream(descriptor, buffer) { attempts.push({ descriptor, bytes: buffer.length }); throw error(`INDEPENDENT_OUTPUT_${descriptor}`); } });
    assert.deepEqual(attempts.map(row => row.descriptor), [1, 2]);
    assert.ok(attempts.every(row => row.bytes <= 32768));
    assert.deepEqual(outcome.failures.map(row => row.phase), ['stdout', 'stderr']);
    assert.equal(outcome.exitCode, 1);
    assert.equal(readDocument(root, outcome.reference.path, outcome.reference.sha256).status, 'ADMISSION_ACCEPTED');
    observe(root, { attempts, exitCode: outcome.exitCode, status: outcome.status, reference: outcome.reference, storedSuccessAloneInsufficient: true });
  },
  D12(root) {
    const store = createStore(root);
    const reference = store.save('read.json', { payload: text(262144) });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, reference.path)));
    reject(() => readDocument(root, reference.path, '0'.repeat(64)), 'REFERENCE_HASH');
    reject(() => readDocument(root, '../read.json', reference.sha256), 'REFERENCE_BINDING');
    reject(() => readDocument(root, 'AGENTS.md', reference.sha256), 'REFERENCE_BINDING');
    reject(() => store.save('AGENTS.md', {}), 'RECORD_NAME');
    reject(() => readDocument(root, reference.path, reference.sha256, 262144), 'REFERENCE_DOCUMENT');
    const missing = folder(root, 'missing');
    fs.writeFileSync(path.join(missing, reference.path), fs.readFileSync(path.join(root, reference.path)), { flag: 'wx', mode: 0o644 });
    reject(() => readDocument(missing, reference.path, reference.sha256), 'ENOENT');
    fs.writeFileSync(path.join(root, 'mode.json'), '{}\n', { flag: 'wx', mode: 0o600 });
    reject(() => readDocument(root, 'mode.json', sha256(Buffer.from('{}\n'))), 'REFERENCE_METADATA');
    const part = path.join(root, descriptor.parts[0].path);
    const changed = fs.readFileSync(part); changed[0] ^= 1; fs.writeFileSync(part, changed);
    reject(() => readDocument(root, reference.path, reference.sha256), 'REFERENCE_HASH');
    assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
    observe(root, { refusals: 8, instructionNameOnly: true, alteredPartRetained: descriptor.parts[0].path });
  },
  D13(root) {
    const sink = capture();
    publish({ output: base(), ledger: createLedger(0), store: createStore(root), writeStream: sink.writeStream });
    const terminal = JSON.parse(Buffer.concat(sink.channels[1]));
    delete terminal.failures;
    writeJson(path.join(root, 'MALFORMED-TERMINAL.json'), terminal);
    let actual;
    let thrown;
    try { actual = assessTerminal(rawReceipt(Buffer.from(JSON.stringify(terminal))), root); } catch (reason) { thrown = { name: reason.name, message: reason.message }; }
    observe(root, { expected: false, actual, thrown: thrown ?? null, authenticatedResultUnchanged: true });
    assert.equal(thrown, undefined, 'boolean assessor must refuse malformed bounded terminal instead of throwing');
    assert.equal(actual, false);
  },
  D14(root) {
    fs.writeFileSync(path.join(root, 'outside.data'), bytes(128), { flag: 'wx', mode: 0o644 });
    const first = createStore(root, { totalLimit: 8 });
    const second = createStore(root, { totalLimit: 8 });
    first.save('first.json', null);
    second.save('second.json', null);
    assert.equal(first.state().accounted, 5);
    assert.equal(second.state().accounted, 5);
    const physicalBeforeObservation = fs.readdirSync(root).reduce((total, name) => total + fs.statSync(path.join(root, name)).size, 0);
    assert.equal(physicalBeforeObservation, 138);
    observe(root, { first: first.state().accounted, second: second.state().accounted, physicalBeforeObservation, contract: 'per-instance attempted-byte accounting only', successorDuty: 'shared accounting of claims/locks/receipts/out-of-store evidence; do not mistake each store limit for whole-run quota' });
  },
  D15(root) {
    const unknown = createLedger(1);
    unknown.starting(unknown.enroll('data-only-unknown'));
    const known = createLedger(1);
    const entry = known.enroll('data-only-unreaped-not-real-pid');
    known.starting(entry);
    known.complete(entry, { pid: 123, reaped: false, exit: null, close: null, natural: false, failures: [], signals: [] });
    known.persisted(entry, '0'.repeat(64));
    const outcomes = [];
    for (const [name, ledger, inheritedExitCode] of [['unknown', unknown, 0], ['known-data-only', known, 0], ['inherited', createLedger(0), 7]]) {
      const sink = capture();
      const outcome = publish({ output: base(), ledger, store: createStore(folder(root, name)), inheritedExitCode, writeStream: sink.writeStream });
      assert.equal(outcome.status, 'UNSAFE_STOP');
      assert.equal(outcome.exitCode, inheritedExitCode || 1);
      outcomes.push({ name, status: outcome.status, exitCode: outcome.exitCode, accounting: outcome.accounting });
    }
    observe(root, outcomes);
  },
  D16(root) {
    const output = { ...base(), fatal: { message: text(300000) }, cleanupErrors: [{ message: text(70000) }] };
    const store = createStore(root);
    const sink = capture();
    const outcome = publish({ output, ledger: createLedger(0), store, writeStream: sink.writeStream });
    const restored = readDocument(root, outcome.reference.path, outcome.reference.sha256);
    assert.deepEqual(restored.fatal, output.fatal);
    assert.deepEqual(restored.cleanupErrors, output.cleanupErrors);
    assert.ok(store.state().writes.every(row => row.bytes <= 262144));
    assert.ok(Buffer.concat(sink.channels[1]).length < 8192);
    assert.equal(outcome.exitCode, 1);
    observe(root, { primaryCharacters: 300000, cleanupCharacters: 70000, retainedTerminalBytes: Buffer.concat(sink.channels[1]).length, physicalAttemptedBytes: store.state().accounted, records: store.state().writes });
  },
  async S17(root) {
    const { ledger, receipt, caught } = await stub(root, 'positive');
    assert.equal(caught, undefined);
    assert.equal(receipt.natural, true);
    assert.equal(ledger.summary().allChildrenReaped, true);
    assert.equal(assessTerminal(decoded(receipt), root), true);
    observe(root, { accepted: true, ledger: ledger.summary(), receiptExit: receipt.exit });
  },
  async S18(root) {
    const { receipt, caught } = await stub(root, 'exit7');
    assert.equal(caught, undefined);
    assert.equal(receipt.exit.code, 7);
    assert.equal(receipt.close.code, 7);
    assert.equal(receipt.natural, false);
    assert.equal(JSON.parse(Buffer.from(receipt.stdout, 'base64')).status, 'ADMISSION_ACCEPTED');
    assert.equal(assessTerminal(decoded(receipt), root), false);
    observe(root, { accepted: false, allPassSummary: true, exit: receipt.exit, close: receipt.close });
  },
  async S19(root) {
    const { ledger, receipt, caught } = await stub(root, 'stdout-failure', true);
    assert.equal(caught?.code, 'LAUNCH_UNSAFE');
    assert.equal(receipt.exit.code, 1);
    assert.equal(receipt.close.code, 1);
    assert.equal(Buffer.from(receipt.stdout, 'base64').length, 0);
    assert.equal(assessTerminal(decoded(receipt), root), false);
    assert.equal(ledger.entries[0].persisted, false);
    assert.equal(ledger.entries[0].emergencyReceipt, receipt);
    assert.equal(ledger.summary().allChildrenReaped, true);
    assert.equal(ledger.summary().unsafe, true);
    const reportRoot = folder(root, 'closure');
    const sink = capture();
    const outcome = publish({ output: base(), ledger, store: createStore(reportRoot), writeStream: sink.writeStream });
    assert.equal(outcome.status, 'UNSAFE_STOP');
    assert.equal(outcome.children[0].pid, receipt.pid);
    observe(root, { ledger: ledger.summary(), knownChild: outcome.children[0], receiptPersistenceFailed: true, childExit: receipt.exit });
  },
  async S20(root) {
    const { receipt, caught } = await stub(root, 'overflow');
    assert.equal(caught, undefined);
    const candidateReceipt = decoded(receipt);
    const actual = assessTerminal(candidateReceipt, root);
    observe(root, { expected: false, actual, captureBytes: receipt.captureBytes, retainedStdoutBytes: candidateReceipt.stdout.length, irrecoverableBytes: receipt.captureBytes.stdout - candidateReceipt.stdout.length, failures: receipt.failures, signals: receipt.signals, exit: receipt.exit, close: receipt.close, reaped: receipt.reaped, natural: receipt.natural });
    assert.equal(receipt.captureBytes.stdout, 65537);
    assert.equal(candidateReceipt.stdout.length, 65536);
    assert.ok(receipt.failures.some(reason => reason.code === 'CAPTURE_LIMIT'));
    assert.equal(receipt.natural, false);
    assert.equal(actual, false, 'actual assessor must reject observed capture-limit violation despite valid retained JSON');
  },
};

let unsafe = false;
for (const [id, expected] of plan.cases) {
  if (unsafe) { rows.push({ id, expected, status: 'UNRUN_UNSAFE_STOP' }); continue; }
  const root = folder(run, id);
  let failure;
  try { authenticate(); await tests[id](root); }
  catch (reason) { failure = { name: reason?.name, code: reason?.code, message: String(reason?.message ?? reason), stack: reason?.stack }; }
  try {
    authenticate();
    assert.ok(children.every(child => child.receipt.reaped && child.pidAbsent && child.groupAbsent));
    assert.ok(handles.every(handle => absent(handle.pid) && absent(-handle.pid)));
  } catch (reason) { unsafe = true; failure ??= { name: reason.name, message: reason.message }; }
  rows.push({ id, expected, status: failure ? 'FAIL' : 'PASS', ...(failure ? { failure } : {}) });
}
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
const activeResources = process.getActiveResourcesInfo().filter(name => !['PipeWrap', 'TTYWrap'].includes(name));
const after = authenticate(true);
const evidence = { schema: 'INDEPENDENT_REPORT_COMPONENT_EVIDENCE_V1', date: '2026-08-28', pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => row.status === 'FAIL').length, unrun: rows.filter(row => row.status.startsWith('UNRUN')).length, unsafe, rows, before, after, generatedInputUpperBound, inputAccounting: 'ASCII generated payload bytes plus conservative1MiB for small literals/fixtures; excludes serialization copies, not RSS', children, activeResources, exactHandlesAbsent: handles.every(handle => absent(handle.pid) && absent(-handle.pid)), noRealEngineImports: true, noHistoricalRescore: true, componentOnly: true };
assert.equal(children.length, 4);
assert.ok(!activeResources.some(name => /Timeout|Process|Immediate/.test(name)));
writeJson(path.join(run, 'EVIDENCE.json'), evidence);
fs.writeSync(3, `${JSON.stringify({ sequence: 0, kind: 'final', report: { pass: evidence.pass, fail: evidence.fail, unrun: evidence.unrun, exactHandlesAbsent: evidence.exactHandlesAbsent } })}\n`);
console.log(JSON.stringify({ pass: evidence.pass, fail: evidence.fail, unrun: evidence.unrun, children: children.length, exactHandlesAbsent: evidence.exactHandlesAbsent }));
if (evidence.fail || evidence.unrun || unsafe) process.exitCode = 1;
