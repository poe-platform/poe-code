import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const owned = process.argv[2];
assert.equal(owned, 'tests/compatibility/bash-ere-core-writer-independent-20260829');
const author = 'tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v7';
const deadline = Date.parse('2026-08-29T15:11:37Z');
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const read = filename => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 16 * 1048576, filename);
  return fs.readFileSync(filename);
};
const log = value => {
  const text = JSON.stringify(value) + '\n';
  assert(fs.statSync(owned + '/DIRECT-CAPTURE.log').size + Buffer.byteLength(text) < 48 * 1048576);
  fs.appendFileSync(owned + '/DIRECT-CAPTURE.log', text);
  console.log(text.trimEnd());
};
const save = (name, value) => {
  const text = JSON.stringify(value, null, 2) + '\n';
  assert(Buffer.byteLength(text) < 2 * 1048576);
  fs.writeFileSync(owned + '/' + name, text, { flag: 'wx' });
};
const sealRaw = read(author + '/EXECUTION-SEAL.json');
assert.equal(hash(sealRaw), '0efb8f129c77f02a119548f9308eca39ad70ca73c5fb548c1fa9918b757326f2');
const seal = JSON.parse(sealRaw);
log({ phase: 'helper2-start', at: new Date().toISOString(), seal });
await import('./audit.mjs');
const audit = JSON.parse(read(owned + '/AUDIT.json'));
const binding = audit.binding;
for (const [name, expected] of [['cell.mjs', binding.newCellSha256], ['dispatch.mjs', binding.newDispatchSha256]]) assert.equal(hash(read(author + '/' + name)), expected);
assert.equal(hash(read(binding.definitions.path)), binding.definitions.sha256);
assert.equal(binding.definitions.sha256, '278f9e51ab2eb96f0bae7564b1357ee9424166e475af10d1e5cb27b9a45fb7fb');
assert.equal(read(owned + '/AUTHOR-DIFF.txt').length, 0);
const writerModule = await import(pathToFileURL(path.resolve(author, 'event-writer.mjs')));
const finalModule = await import(pathToFileURL(path.resolve(author, 'finalize-cell.mjs')));
const { createEventWriter, createFailureLedger, describeFailures } = writerModule;
const { finalizeCell } = finalModule;
const rows = [];
const test = async (id, body) => {
  assert(Date.now() + 180000 < deadline, 'publication reserve');
  try { await body(); rows.push({ id, status: 'PASS' }); }
  catch (reason) { rows.push({ id, status: 'FAIL', reason: String(reason), stack: reason?.stack }); }
};
const caught = action => {
  let present = false, reason;
  try { action(); } catch (error) { present = true; reason = error; }
  assert(present);
  return reason;
};
const sink = options => {
  const chunks = [];
  let calls = 0;
  const writer = createEventWriter({ descriptor: 17, ...options, write(descriptor, bytes, offset, length) {
    calls++;
    const count = Math.min(length, 3);
    chunks.push(Buffer.from(bytes.subarray(offset, offset + count)));
    return count;
  }, close: options?.close ?? (() => {}) });
  return { writer, chunks, calls: () => calls };
};
let authorResult;
const replay = async () => {
  const source = read(author + '/controls.mjs').toString();
  const original = JSON.parse(read(author + '/CONTROL-RESULT.json'));
  const controlledFs = { readFileSync: fs.readFileSync, writeFileSync(filename, text, options) {
    assert.equal(filename, path.resolve(author, 'CONTROL-RESULT.json'));
    assert.equal(options.flag, 'wx');
    assert.equal(authorResult, undefined);
    authorResult = JSON.parse(text);
  } };
  const controlledProcess = { exitCode: 0 };
  const context = vm.createContext({ Buffer, console: { log() {} }, process: controlledProcess, URL });
  const modules = new Map();
  const namespace = (key, values) => {
    if (!modules.has(key)) modules.set(key, new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context }));
    return modules.get(key);
  };
  const control = new vm.SourceTextModule(source, { context, identifier: path.resolve(author, 'controls.mjs'), initializeImportMeta(meta) { meta.url = pathToFileURL(path.resolve(author, 'controls.mjs')).href; } });
  await control.link(specifier => {
    if (specifier === 'node:assert/strict') return namespace(specifier, { default: assert });
    if (specifier === 'node:fs') return namespace(specifier, { default: controlledFs });
    if (specifier === 'node:path') return namespace(specifier, { default: path });
    if (specifier === 'node:vm') return namespace(specifier, { default: vm });
    if (specifier === './event-writer.mjs') return namespace(specifier, writerModule);
    if (specifier === './finalize-cell.mjs') return namespace(specifier, finalModule);
    throw new Error('Forbidden control import ' + specifier);
  });
  await control.evaluate({ timeout: 10000 });
  assert.equal(authorResult.rows.length, 12);
  assert.deepEqual(Array.from(authorResult.rows, row => row.id), original.rows.map(row => row.id));
  save('AUTHOR-REPLAY.json', { sourceSha256: hash(Buffer.from(source)), adaptation: 'Unmodified source evaluated in VM; only final fs.writeFileSync redirected into reviewer-owned evidence; fs reads unchanged. No product import.', result: authorResult });
  log({ phase: 'author-replay', pass: authorResult.pass, fail: authorResult.fail });
  await test('N01-variable-short-multiple-unicode-exact-boundary', () => {
    const values = [{ value: '😀雪\ud800\n' }, false, null, 0];
    const expected = Buffer.from(values.map(value => JSON.stringify(value) + '\n').join(''));
    const target = sink({ byteLimit: expected.length });
    for (const value of values) target.writer.emit(value);
    assert(Buffer.concat(target.chunks).equals(expected));
    const before = target.calls();
    assert(caught(() => target.writer.emit('')) instanceof RangeError);
    assert.equal(target.calls(), before);
    assert.equal(target.writer.snapshot().written, expected.length);
  });
  await test('N02-partial-then-every-invalid-count-sticky', () => {
    for (const invalid of [-0, Number.MAX_SAFE_INTEGER + 1, 1n, Symbol('count'), {}, 2.5, -1, NaN, Infinity, undefined]) {
      let calls = 0;
      const writer = createEventWriter({ descriptor: 1, write() { return ++calls === 1 ? 2 : invalid; }, close() {} });
      const reason = caught(() => writer.emit({ text: '雪' }));
      assert.strictEqual(caught(() => writer.emit(1)), reason);
      assert.equal(calls, 2);
      assert.equal(writer.snapshot().written, 2);
      assert.equal(writer.snapshot().admitted, Buffer.byteLength('{"text":"雪"}\n'));
    }
  });
  await test('N03-partial-throw-falsy-and-object-identities', () => {
    for (const primary of [undefined, null, false, 0, '', Object.freeze({ id: 1 })]) {
      let calls = 0;
      const writer = createEventWriter({ descriptor: 1, write() { if (++calls === 1) return 1; throw primary; }, close() { throw 'secondary'; } });
      assert.strictEqual(caught(() => writer.emit(123)), primary);
      assert.strictEqual(caught(() => writer.close()), 'secondary');
      assert.strictEqual(caught(() => writer.emit(123)), primary);
      assert.deepEqual(writer.snapshot(), { byteLimit: 262144, admitted: 4, written: 1, closeAttempted: true, closed: false, failed: true });
    }
  });
  await test('N04-nonserializable-and-toJSON-falsy-before-write', () => {
    for (const value of [undefined, Symbol('row'), () => {}, 1n, { toJSON() { return undefined; } }, { toJSON() { throw ''; } }]) {
      const target = sink();
      const reason = caught(() => target.writer.emit(value));
      assert.strictEqual(caught(() => target.writer.emit(1)), reason);
      assert.equal(target.calls(), 0);
      assert.equal(target.writer.snapshot().admitted, 0);
    }
  });
  await test('N05-admission-precedes-buffer-allocation', () => {
    const original = Buffer.from;
    let allocations = 0, calls = 0;
    Buffer.from = function (...arguments_) { allocations++; return original(...arguments_); };
    try {
      const writer = createEventWriter({ descriptor: 1, byteLimit: 0, write() { calls++; return 1; }, close() {} });
      assert(caught(() => writer.emit('雪')) instanceof RangeError);
      assert.equal(allocations, 0);
      assert.equal(calls, 0);
    } finally { Buffer.from = original; }
  });
  await test('N06-all-cleanups-terminal-close-audit-raw-order', async () => {
    const primary = Object.freeze({ body: true }), secondary = Object.freeze({ cleanup: true });
    const failures = createFailureLedger();
    failures.record(primary, 'body');
    const calls = [];
    const writer = createEventWriter({ descriptor: 1, write() { calls.push('terminal'); throw 0; }, close() { calls.push('close'); throw null; } });
    const actions = ['shell', 'arrays', 'worker', 'array-restore', 'worker-restore'].map(phase => ({ phase, async run() { calls.push(phase); throw secondary; } }));
    const final = await finalizeCell({ failures, actions, writer, audit: { emit() { calls.push('audit'); throw undefined; } }, id: 'synthetic', workers: [] });
    assert.deepEqual(calls, ['shell', 'arrays', 'worker', 'array-restore', 'worker-restore', 'terminal', 'close', 'audit']);
    assert.strictEqual(final.failures.primary, primary);
    assert.deepEqual(final.failures.secondary.map(row => row.reason), [secondary, secondary, secondary, secondary, secondary, 0, null, undefined]);
    assert.equal(final.exitCode, 1);
    assert.equal(final.retired, false);
  });
  await test('N07-identity-no-inspection-and-bounded-description', () => {
    const hostile = new Proxy({}, { get() { throw new Error('inspected'); }, ownKeys() { throw new Error('enumerated'); } });
    const ledger = createFailureLedger();
    ledger.record(hostile, 'body');
    ledger.record(hostile, 'cleanup');
    ledger.record({}, 'cleanup');
    ledger.record('雪'.repeat(1000), 'cleanup');
    for (let index = 0; index < 20; index++) ledger.record(false, 'cleanup');
    const state = ledger.snapshot(), described = describeFailures(state);
    assert.equal(state.secondary.length, 16);
    assert.equal(state.omittedSecondary, 7);
    assert.equal(described.primary.reason.identity, described.secondary[0].reason.identity);
    assert.notEqual(described.primary.reason.identity, described.secondary[1].reason.identity);
    assert.equal(described.secondary[2].reason.prefix.length, 256);
    state.secondary.pop();
    assert.equal(ledger.snapshot().secondary.length, 16);
  });
  await test('N08-absent-writer-close-once-and-audit-falsy', async () => {
    const failures = createFailureLedger();
    failures.record(undefined, 'open');
    let attempts = 0;
    const final = await finalizeCell({ failures, actions: [{ phase: 'restore', run() { attempts++; } }], writer: undefined, audit: { emit(row) { assert.equal(row.eventWriter, null); throw false; } }, id: undefined, workers: [] });
    assert.equal(attempts, 1);
    assert.strictEqual(final.failures.primary, undefined);
    assert.strictEqual(final.failures.secondary[0].reason, false);
    assert.equal(final.exitCode, 1);
    const target = sink({ close() { attempts++; } });
    target.writer.close(); target.writer.close();
    assert.equal(attempts, 2);
    caught(() => target.writer.emit(1));
    assert.equal(target.calls(), 0);
  });
  save('NOVEL-RESULT.json', { phase: 'PURE_ONLY', rows, pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => row.status === 'FAIL').length, products: 0, workers: 0, native: 0 });
  log({ phase: 'novel-results', rows });
};
const commands = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
log({ phase: 'ready', commands: ['inspect NAME START END', 'run', 'finish'] });
for await (const command of commands) {
  try {
    const [action, name, first = '1', last = '80'] = command.trim().split(' ');
    if (action === 'inspect') {
      assert(/^[A-Za-z0-9.-]+$/.test(name));
      log({ name, lines: read(author + '/' + name).toString().split('\n').slice(Number(first) - 1, Number(last)) });
    } else if (action === 'run') await replay();
    else if (action === 'finish') {
      assert(authorResult);
      const files = fs.readdirSync(owned).sort().map(name => ({ name, bytes: fs.lstatSync(owned + '/' + name).size, sha256: hash(read(owned + '/' + name)) }));
      const logicalBytes = files.reduce((sum, row) => sum + row.bytes, 0);
      assert(logicalBytes + 1048576 < 192 * 1048576);
      save('RECEIPT.json', { at: new Date().toISOString(), start: '2026-08-29T14:56:37Z', deadline: new Date(deadline).toISOString(), source: 'e33b99af9fbec345b4f5a76d50f627c3d4d9f73a', evidence: 'd40efe4068545ecff91cfb4051806dc0417427da', sealSha256: hash(sealRaw), authorPass: authorResult.pass, authorFail: authorResult.fail, novelPass: rows.filter(row => row.status === 'PASS').length, novelFail: rows.filter(row => row.status === 'FAIL').length, helpers: { maximum: 2, actual: 2, first: 'permission-denied before controls; preserved raw', second: 'restricted VM replay + novel PURE + DATA audit' }, files, logicalBytesBeforeReceiptAndPublication: logicalBytes, publicationReserveBytes: 1048576, actualProduct: false, actualWorkers: 0, actualNative: 0, bound: { logicalMaximum: 332129069, uniqueCaptureMaximum: 131072000, qualification: 'conditional prospective logical regular-file accounting; not OS disk/RSS/Git physical quota or fresh materialized-layout qualification' } });
      log({ phase: 'finished', logicalBytesBeforeReceiptAndPublication: logicalBytes, at: new Date().toISOString() });
      break;
    } else throw new Error('Unknown command');
  } catch (reason) { log({ phase: 'command-failure', command, reason: String(reason), stack: reason?.stack }); }
}
