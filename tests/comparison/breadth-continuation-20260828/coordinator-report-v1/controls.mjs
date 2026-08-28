import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStore, readDocument, encode, limits, digest } from './records.mjs';
import { publish, assessTerminal } from './publisher.mjs';
import { createLedger, launchTracked } from '../executor-v4/launch-ledger.mjs';
import { supervise } from '../executor-v4/supervisor.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(directory, 'runs/synthetic-v1-01');
const seal = JSON.parse(fs.readFileSync(path.join(directory, 'SEAL.json')));
const plan = JSON.parse(fs.readFileSync(path.join(directory, 'CASES.json')));
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const verify = () => {
  for (const entry of seal.files) { const info = fs.lstatSync(path.resolve(directory, entry.path)); assert.ok(info.isFile() && !info.isSymbolicLink()); assert.equal(info.size, entry.bytes); assert.equal(info.mode & 0o7777, entry.mode); assert.equal(digest(fs.readFileSync(path.resolve(directory, entry.path))), entry.sha256); }
  assert.equal(digest(fs.readFileSync(node)), seal.node.sha256);
};
verify();
const overlay = JSON.parse(fs.readFileSync(path.join(directory, 'OVERLAY.json')));
for (const row of overlay.rows) {
  let source = fs.readFileSync(path.resolve(directory, '../../../..', row.path), 'utf8');
  assert.equal(digest(source), row.beforeSha256);
  for (const edit of row.edits) { assert.equal(source.split(edit.before).length - 1, 1); source = source.replace(edit.before, edit.after); }
  assert.equal(digest(source), row.afterSha256);
}
fs.mkdirSync(path.dirname(run), { recursive: true });
fs.mkdirSync(run, { recursive: false });
const evidence = createStore(run);
const ledger = createLedger(4);
const rows = [];
const quiet = { entries: [], summary: () => ({ enrolled: 0, attempted: 0, launched: 0, closed: 0, unknownAcquisitions: 0, allChildrenReaped: null, unsafe: false }) };
const base = () => ({ mode: 'admission', runId: 'SYNTHETIC-ONLY', status: 'ADMISSION_ACCEPTED', unsafe: false, explicitlySyntheticNoEngines: true });
const codeError = code => Object.assign(new Error(code), { code });
const rejected = (action, code) => assert.throws(action, error => error?.code === code);
const own = name => { const root = path.join(run, name); fs.mkdirSync(root); return root; };
const collect = () => { const channels = { 1: [], 2: [] }; return { channels, writeStream: (descriptor, bytes) => { assert.ok(bytes.length <= limits.stream); channels[descriptor].push(Buffer.from(bytes)); } }; };
async function driver(mode, root) {
  const receipt = await launchTracked({ ledger, kind: `synthetic-${mode}`, prepare: async () => ({ configSha: seal.files.find(row => row.path === 'driver.mjs').sha256 }), supervise: (_, attach) => supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(directory, 'driver.mjs'), mode, root], root, { onSpawn: attach }), persist: (entry, value) => evidence.save(`driver-${entry.ordinal}.json`, value).sha256 });
  assert.ok(receipt.reaped && receipt.exit && receipt.close);
  assert.deepEqual(receipt.failures, []);
  return { ...receipt, stdout: Buffer.from(receipt.stdout, 'base64'), stderr: Buffer.from(receipt.stderr, 'base64') };
}
const tests = {
  R01(root) {
    const store = createStore(root), sink = collect();
    const outcome = publish({ output: base(), ledger: quiet, store, writeStream: sink.writeStream });
    assert.equal(outcome.exitCode, 0);
    assert.equal(readDocument(root, outcome.reference.path, outcome.reference.sha256).status, 'ADMISSION_ACCEPTED');
    const receipt = { exit: { code: 0 }, close: { code: 0 }, reaped: true, stdout: Buffer.concat(sink.channels[1]), stderr: Buffer.alloc(0) };
    assert.equal(assessTerminal(receipt, root), true);
    assert.equal(assessTerminal(receipt, path.join(root, 'absent')), false);
  },
  R02(root) {
    const store = createStore(root), sink = collect();
    const output = { ...base(), fatal: { code: 'PRIMARY', message: 'primary'.repeat(80000) }, cleanupErrors: [{ code: 'CLEANUP', message: 'later'.repeat(40000) }] };
    const outcome = publish({ output, ledger: quiet, store, writeStream: sink.writeStream });
    assert.equal(outcome.status, 'UNSAFE_STOP');
    const restored = readDocument(root, outcome.reference.path, outcome.reference.sha256);
    assert.deepEqual(restored.fatal, output.fatal); assert.deepEqual(restored.cleanupErrors, output.cleanupErrors);
    assert.ok(store.state().writes.length > 2 && store.state().writes.every(row => row.bytes <= limits.record));
    assert.ok(Buffer.concat(sink.channels[1]).length < 4096);
  },
  R03(root) {
    for (const [name, primary] of [['null', null], ['undefined', undefined]]) {
      const target = path.join(root, name); fs.mkdirSync(target);
      const store = createStore(target, { io: { ...fs, openSync: () => { throw codeError('PERSISTENCE'); } } });
      const sink = collect();
      const outcome = publish({ output: { ...base(), fatal: primary, cleanupErrors: [{ code: 'LATER_CLEANUP' }] }, ledger: quiet, store, writeStream: sink.writeStream });
      assert.equal(outcome.primary.present, true); assert.equal(outcome.primary.value, primary);
      assert.deepEqual(outcome.failures.map(row => row.phase), ['result-publication', 'failure-publication']);
      assert.equal(outcome.exitCode, 1); assert.equal(outcome.status, 'UNSAFE_STOP');
    }
  },
  R04(root) {
    const store = createStore(root);
    rejected(() => store.save('huge.json', 'x'.repeat(limits.document + 1)), 'DOCUMENT_CAP');
    rejected(() => encode('\u0000'.repeat(1000), 4096), 'DOCUMENT_CAP');
    assert.equal(store.state().writes.length, 0);
  },
  R05(root) {
    const store = createStore(root), cycle = {}; cycle.self = cycle;
    rejected(() => store.save('cycle.json', cycle), 'SERIALIZATION_CYCLE');
    let called = 0; const accessor = {}; Object.defineProperty(accessor, 'x', { enumerable: true, get() { called++; throw codeError('GETTER'); } });
    rejected(() => store.save('accessor.json', accessor), 'SERIALIZATION_ACCESSOR');
    rejected(() => store.save('tojson.json', { toJSON() { called++; } }), 'SERIALIZATION_TOJSON');
    rejected(() => store.save('bigint.json', { value: 1n }), 'SERIALIZATION_TYPE');
    assert.equal(called, 0); assert.equal(store.state().writes.length, 0);
    const sink = collect(); const outcome = publish({ output: { ...base(), circular: cycle }, ledger: quiet, store, writeStream: sink.writeStream });
    assert.equal(outcome.status, 'UNSAFE_STOP'); assert.equal(outcome.failures[0].selected.value.code, 'SERIALIZATION_CYCLE');
  },
  R06(root) {
    rejected(() => createStore(root, { totalLimit: limits.evidence + 1 }), 'EVIDENCE_LIMIT');
    const store = createStore(root, { totalLimit: 1024 }); store.save('one.json', 'x'.repeat(700));
    rejected(() => store.save('two.json', 'x'.repeat(700)), 'EVIDENCE_CAP');
    assert.ok(store.state().accounted <= 1024);
  },
  R07(root) {
    const primary = codeError('WRITE_PRIMARY'), cleanup = codeError('CLOSE_LATER');
    const store = createStore(root, { io: { ...fs, writeSync() { throw primary; }, closeSync(descriptor) { fs.closeSync(descriptor); throw cleanup; } } });
    assert.throws(() => store.save('both.json', {}), error => error.code === 'RECORD_WRITE_AND_CLOSE' && error.primary === primary && error.cleanup === cleanup);
    assert.equal(store.state().writes[0].closeFailure, true);
    for (const [name, value] of [['null', null], ['undefined', undefined]]) {
      const target = path.join(root, name); fs.mkdirSync(target);
      const collision = createStore(target, { io: { ...fs, writeSync() { throw value; }, closeSync(descriptor) { fs.closeSync(descriptor); throw cleanup; } } });
      assert.throws(() => collision.save('both.json', {}), error => error.code === 'RECORD_WRITE_AND_CLOSE' && error.primaryPresent === true && error.primary === value && error.cleanup === cleanup);
    }
  },
  R08(root) {
    let opens = 0; const store = createStore(root, { io: { ...fs, openSync(...args) { if (++opens === 2) throw codeError('PART_WRITE'); return fs.openSync(...args); } } });
    const sink = collect(); const outcome = publish({ output: { ...base(), payload: 'part'.repeat(150000) }, ledger: quiet, store, writeStream: sink.writeStream });
    assert.equal(outcome.status, 'UNSAFE_STOP'); assert.equal(outcome.reference, null);
    assert.equal(fs.statSync(path.join(root, 'RESULT.json.part-0000.data')).size, limits.record);
    assert.equal(fs.existsSync(path.join(root, 'RESULT.json')), false);
    assert.ok(outcome.failures.some(row => row.selected.value.code === 'PART_WRITE'));
  },
  R09(root) {
    const known = { entries: [{ ordinal: 1, pid: 123, group: -123, reaped: true, exit: { code: 1 }, close: { code: 1 }, persisted: false }], summary: () => ({ launched: 1, allChildrenReaped: true, unsafe: true }) };
    let attempts = 0;
    const outcome = publish({ output: { ...base(), fatal: null }, ledger: known, store: createStore(root), writeStream() { attempts++; throw codeError('OUTPUT'); } });
    assert.equal(attempts, 2); assert.equal(outcome.primary.value, null); assert.equal(outcome.children[0].pid, 123);
    assert.deepEqual(outcome.failures.map(row => row.phase), ['stdout', 'stderr']); assert.equal(outcome.exitCode, 1);
  },
  R10(root) {
    const store = createStore(root); const ref = store.save('bound.json', { payload: 'x'.repeat(300000) });
    rejected(() => readDocument(root, ref.path, '0'.repeat(64)), 'REFERENCE_HASH');
    rejected(() => readDocument(root, '../bound.json', ref.sha256), 'REFERENCE_BINDING');
    rejected(() => readDocument(root, 'AGENTS.md', ref.sha256), 'REFERENCE_BINDING');
    rejected(() => readDocument(root, ref.path, ref.sha256, 262144), 'REFERENCE_DOCUMENT');
    const envelope = JSON.parse(fs.readFileSync(path.join(root, ref.path)));
    const bad = { ...envelope, parts: envelope.parts.map((row, index) => index === 0 ? { ...row, path: 'missing.data' } : row) };
    const badRef = store.save('bad.json', bad); rejected(() => readDocument(root, badRef.path, badRef.sha256), 'REFERENCE_PART_BINDING');
    fs.writeFileSync(path.join(root, 'mode.json'), '{}\n', { flag: 'wx', mode: 0o600 });
    rejected(() => readDocument(root, 'mode.json', digest(Buffer.from('{}\n'))), 'REFERENCE_METADATA');
    fs.writeFileSync(path.join(root, 'oversize.json'), Buffer.alloc(limits.record + 1), { flag: 'wx' });
    rejected(() => readDocument(root, 'oversize.json', '0'.repeat(64)), 'REFERENCE_METADATA');
    const missingRoot = path.join(root, 'missing-root'); fs.mkdirSync(missingRoot);
    fs.writeFileSync(path.join(missingRoot, ref.path), fs.readFileSync(path.join(root, ref.path)), { flag: 'wx' });
    assert.throws(() => readDocument(missingRoot, ref.path, ref.sha256), error => error.code === 'ENOENT');
    const part = path.join(root, envelope.parts[0].path); const original = fs.readFileSync(part); fs.writeFileSync(part, Buffer.alloc(original.length, 1));
    rejected(() => readDocument(root, ref.path, ref.sha256), 'REFERENCE_HASH');
  },
  R11(root) {
    const store = createStore(root); const ref = store.save('exact.json', 'x'.repeat(limits.record - 3));
    assert.equal(ref.bytes, limits.record); assert.equal(store.state().writes.length, 1);
    const data = { message: '\u0000\n\t"\\é😀\ud800', missing: undefined, array: [undefined, null, NaN] };
    assert.equal(encode(data).toString(), `${JSON.stringify(data)}\n`);
  },
  async R12(root) { const receipt = await driver('positive', root); assert.equal(receipt.exit.code, 0); assert.equal(assessTerminal(receipt, root), true); },
  async R13(root) { const receipt = await driver('post-summary-nonzero', root); assert.equal(JSON.parse(receipt.stdout).status, 'ADMISSION_ACCEPTED'); assert.equal(receipt.exit.code, 7); assert.equal(assessTerminal(receipt, root), false); },
  async R14(root) { const receipt = await driver('stdout-failure', root); assert.equal(receipt.exit.code, 1); assert.equal(receipt.stdout.length, 0); assert.ok(receipt.stderr.length > 0 && receipt.stderr.length <= limits.stream); assert.equal(JSON.parse(receipt.stderr).status, 'UNSAFE_STOP'); assert.equal(assessTerminal(receipt, root), false); },
  async R15(root) {
    let caught;
    try { await launchTracked({ ledger, kind: 'intentional-persistence-fault', prepare: async () => ({ configSha: seal.files.find(row => row.path === 'stub.mjs').sha256 }), supervise: (_, attach) => supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(directory, 'stub.mjs')], root, { onSpawn: attach }), persist() { throw codeError('CAPTURE_PERSISTENCE'); } }); }
    catch (error) { caught = error; }
    assert.equal(caught?.code, 'LAUNCH_UNSAFE');
    const entry = ledger.entries.at(-1); assert.ok(entry.pid && entry.group && entry.reaped && entry.exit && entry.close && entry.emergencyReceipt);
    assert.equal(entry.errors[0].phase, 'persist');
    evidence.save('intentional-failed-persistence-receipt.json', entry.emergencyReceipt);
    const sink = collect(); const outcome = publish({ output: { ...base(), fatal: { code: caught.code } }, ledger, store: createStore(root), writeStream: sink.writeStream });
    assert.equal(outcome.status, 'UNSAFE_STOP'); assert.equal(outcome.children.at(-1).pid, entry.pid);
  },
  R16(root) {
    const known = { entries: [{ ordinal: 1, pid: 123, group: -123, reaped: false, exit: null, close: null }], summary: () => ({ launched: 1, allChildrenReaped: false, unsafe: false }) };
    const sink = collect(); const outcome = publish({ output: base(), ledger: known, inheritedExitCode: 7, store: createStore(root), writeStream: sink.writeStream });
    assert.equal(outcome.status, 'UNSAFE_STOP'); assert.equal(outcome.exitCode, 7);
  },
};
let unsafe = false;
for (const [id, description] of plan.cases) {
  if (unsafe) { rows.push({ id, status: 'UNRUN_UNSAFE_STOP' }); continue; }
  let error;
  try { verify(); await tests[id](own(id)); }
  catch (caught) { error = { name: caught.name, code: caught.code, message: caught.message, stack: caught.stack }; }
  try { verify(); assert.ok(ledger.entries.every(entry => !entry.launchAttempted || (entry.reaped && entry.exit && entry.close))); }
  catch (caught) { unsafe = true; error ??= { name: caught.name, message: caught.message }; }
  rows.push({ id, description, status: error ? 'FAIL' : 'PASS', ...(error ? { error } : {}) });
}
const result = { schema: 'SYNTHETIC_REPORT_REPAIR_RESULT', engineExecutions: 0, oldCaptureReplays: 0, rows, unsafe, launched: ledger.entries.length, ledger: ledger.entries, allChildrenReaped: ledger.entries.every(entry => entry.reaped), expectedNegativeChildren: ['post-summary-nonzero:exit7', 'stdout-failure:exit1', 'stub:exit0 then intentional receipt persistence fault'], originalAdmissionUnchanged: true };
evidence.save('RESULT.json', result);
console.log(JSON.stringify({ pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => row.status === 'FAIL').length, unrun: rows.filter(row => row.status.startsWith('UNRUN')).length, children: result.launched, reaped: result.allChildrenReaped, unsafe, report: path.join(run, 'RESULT.json') }));
if (unsafe || rows.some(row => row.status !== 'PASS')) process.exitCode = 1;
