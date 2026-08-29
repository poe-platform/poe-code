import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const owned = process.argv[2];
const prior = 'tests/compatibility/bash-ere-core-writer-independent-20260829';
assert.equal(owned, prior + '/c09-correction-v1');
const author = 'tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/v7';
const deadline = Date.parse('2026-08-29T15:12:09Z');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= 2 * 1048576, filename);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
};
const save = (name, value) => {
  const text = JSON.stringify(value, null, 2) + '\n';
  assert(Buffer.byteLength(text) < 1048576);
  fs.writeFileSync(owned + '/' + name, text, { flag: 'wx' });
  return hash(Buffer.from(text));
};
const preservedNames = ['AUDIT.json', 'AUTHOR-DIFF.txt', 'AUTHOR-REPLAY.json', 'DIRECT-CAPTURE.log', 'NOVEL-RESULT.json', 'RECEIPT.json', 'REVIEW.md', 'audit.mjs', 'review.mjs'];
const preserved = preservedNames.map(name => ({ name, sha256: hash(read(prior + '/' + name)) }));
const audit = JSON.parse(read(prior + '/AUDIT.json'));
const sealBytes = read(author + '/EXECUTION-SEAL.json');
assert.equal(hash(sealBytes), '0efb8f129c77f02a119548f9308eca39ad70ca73c5fb548c1fa9918b757326f2');
const bindings = ['controls.mjs', 'event-writer.mjs', 'finalize-cell.mjs'].map(name => {
  const expected = audit.rows.find(row => row.name === name);
  const bytes = read(author + '/' + name);
  assert.equal(hash(bytes), expected.sha256);
  assert.equal(bytes.length, expected.size);
  return { name, bytes: bytes.length, sha256: hash(bytes) };
});
const original = JSON.parse(read(prior + '/AUTHOR-REPLAY.json'));
assert.equal(original.result.pass, 11);
assert.equal(original.result.fail, 1);
assert.equal(original.result.rows.find(row => row.status === 'FAIL').id, 'C09-every-cleanup-attempted');
const novel = JSON.parse(read(prior + '/NOVEL-RESULT.json'));
assert.equal(novel.pass, 8);
assert.equal(novel.fail, 0);

export function assertOwnPrimitiveArray(actual, expected) {
  const inspect = value => {
    assert(Array.isArray(value), 'expected array shape');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    assert(length && Object.hasOwn(length, 'value') && !Object.hasOwn(length, 'get') && !Object.hasOwn(length, 'set'), 'own data length');
    assert(Number.isSafeInteger(length.value) && length.value >= 0 && length.value <= 64, 'finite bounded length');
    assert.equal(length.enumerable, false, 'length enumerable');
    assert.equal(length.configurable, false, 'length configurable');
    assert.equal(length.writable, true, 'length writable');
    const keys = Reflect.ownKeys(value);
    assert.equal(keys.length, length.value + 1, 'exact own key count');
    const values = [];
    for (let index = 0; index < length.value; index++) {
      assert.equal(keys[index], String(index), 'exact ordered index key');
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      assert(descriptor && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), 'own data index');
      assert.equal(descriptor.enumerable, true, 'index enumerable');
      assert.equal(descriptor.configurable, true, 'index configurable');
      assert.equal(descriptor.writable, true, 'index writable');
      const primitive = descriptor.value;
      assert(primitive === null || primitive === undefined || typeof primitive === 'boolean' || typeof primitive === 'string' || (typeof primitive === 'number' && Number.isFinite(primitive)), 'finite permitted primitive');
      values.push(primitive);
    }
    assert.equal(keys[length.value], 'length', 'exact final key');
    return values;
  };
  const actualValues = inspect(actual), expectedValues = inspect(expected);
  assert.equal(actualValues.length, expectedValues.length, 'sequence length');
  for (let index = 0; index < actualValues.length; index++) assert(Object.is(actualValues[index], expectedValues[index]), 'primitive type/value/order');
}

const { createEventWriter, createFailureLedger } = await import(pathToFileURL(path.resolve(author, 'event-writer.mjs')));
const { finalizeCell } = await import(pathToFileURL(path.resolve(author, 'finalize-cell.mjs')));
const correctedAssert = Object.assign(function (...arguments_) { return assert(...arguments_); }, assert, { deepEqual: assertOwnPrimitiveArray });
const source = read(author + '/controls.mjs').toString();
const preludeStart = source.indexOf('const rows = [];');
const preludeEnd = source.indexOf("await test('C01-");
assert(preludeStart >= 0 && preludeEnd > preludeStart);
const c09Lines = source.split('\n').filter(line => line.startsWith("await test('C09-every-cleanup-attempted',"));
assert.equal(c09Lines.length, 1);
const context = vm.createContext({ Buffer, injected: { assert: correctedAssert, createEventWriter, createFailureLedger, finalizeCell } });
const moduleText = 'const { assert, createEventWriter, createFailureLedger, finalizeCell } = globalThis.injected;\n' + source.slice(preludeStart, preludeEnd) + c09Lines[0] + '\nglobalThis.c09Result = rows;\n';
assert(Date.now() + 120000 < deadline, 'case plus publication reserve');
const control = new vm.SourceTextModule(moduleText, { context, identifier: 'independent-c09-correction' });
await control.link(specifier => { throw new Error('No control imports permitted: ' + specifier); });
await control.evaluate({ timeout: 5000 });
assert.equal(context.c09Result.length, 1);
const results = Array.from(context.c09Result, row => ({ id: row.id, status: row.status, ...(row.reason ? { reason: row.reason, stack: row.stack } : {}) }));
const test = (id, body) => {
  assert(Date.now() + 120000 < deadline, 'control plus publication reserve');
  try { body(); results.push({ id, status: 'PASS' }); }
  catch (reason) { results.push({ id, status: 'FAIL', reason: String(reason), stack: reason?.stack }); }
};
const remote = expression => vm.runInContext(expression, context, { timeout: 1000 });
test('X01-cross-realm-exact-keys-and-descriptors', () => {
  const malformed = remote(`(() => {
    const extra = [false, 0]; extra.extra = true;
    const symbol = [false, 0]; symbol[Symbol('extra')] = true;
    const hidden = [false, 0]; Object.defineProperty(hidden, '0', { enumerable: false });
    const fixedLength = [false, 0]; Object.defineProperty(fixedLength, 'length', { writable: false });
    return [[, 0], extra, symbol, hidden, Object.freeze([false, 0]), fixedLength, { 0: false, 1: 0, length: 2 }];
  })()`);
  for (const value of malformed) assert.throws(() => assertOwnPrimitiveArray(value, [false, 0]));
});
test('X02-cross-realm-accessor-rejection-without-invocation', () => {
  const accessor = remote(`(() => {
    globalThis.accessorCalls = 0;
    const value = [false, 0];
    Object.defineProperty(value, '0', { enumerable: true, configurable: true, get() { globalThis.accessorCalls++; return false; }, set() { globalThis.accessorCalls++; } });
    return value;
  })()`);
  assert.throws(() => assertOwnPrimitiveArray(accessor, [false, 0]), /own data index/);
  assert.equal(context.accessorCalls, 0);
});
test('X03-cross-realm-primitive-types-values-and-order', () => {
  const malformed = remote(`[['false', 0], [false, '0'], [false, -0], [false, null], [false, undefined], [false, {}], [false, new Number(0)], [false, NaN], [false, Infinity], [0, false]]`);
  for (const value of malformed) assert.throws(() => assertOwnPrimitiveArray(value, [false, 0]));
});
for (const row of preserved) assert.equal(hash(read(prior + '/' + row.name)), row.sha256, 'prior evidence changed: ' + row.name);
for (const row of bindings) assert.equal(hash(read(author + '/' + row.name)), row.sha256, 'author input changed: ' + row.name);
const pass = results.filter(row => row.status === 'PASS').length;
const fail = results.length - pass;
const result = { phase: 'REVIEWER_C09_CORRECTION_PURE_ONLY', results, pass, fail, sourceUnmodified: true, c09LineSha256: hash(Buffer.from(c09Lines[0])), generatedControlSha256: hash(Buffer.from(moduleText)), comparatorSha256: hash(Buffer.from(assertOwnPrimitiveArray.toString())), realmPolicy: 'VM author C09 plus unchanged main-realm writer/finalizer; only deepEqual replaced with explicit own-key/data-descriptor/finite-primitive comparison; no prototype identity or JSON coercion', inherited: { otherAuthorControls: 11, novelGroups: 8, rerun: false, originalReplayUnchanged: true }, products: 0, Workers: 0, native: 0 };
const resultSha256 = save('RESULT.json', result);
const snapshot = Object.freeze(fs.readdirSync(owned).sort().map(name => ({ name, bytes: fs.lstatSync(owned + '/' + name).size, sha256: hash(read(owned + '/' + name)) })));
const logicalBytes = snapshot.reduce((sum, row) => sum + row.bytes, 0);
assert(logicalBytes + 1048576 < 96 * 1048576);
const receipt = { at: new Date().toISOString(), start: '2026-08-29T15:06:09Z', publicationDeadline: new Date(deadline).toISOString(), source: 'e33b99af9fbec345b4f5a76d50f627c3d4d9f73a', authorEvidence: 'd40efe4068545ecff91cfb4051806dc0417427da', priorReviewPrefix: 'c14ced251', sealSha256: hash(sealBytes), helperSha256: hash(read(owned + '/correct-c09.mjs')), authorBindings: bindings, preservedPriorFiles: preserved, resultSha256, pureHelperInvocations: 1, observedPass: pass, observedFail: fail, verdict: fail ? 'SOURCE ACCEPT / PURE HOLD' : 'SOURCE ACCEPT / PURE ACCEPT — version-qualified composition, not fresh 12+8 rerun', inherited: result.inherited, limits: { millisecondsIncludingPublication: 360000, knownOsMaximum: 18, peakKnownOsMaximum: 3, captureBytes: 25165824, logicalWorkingBytes: 100663296 }, ownedSnapshotBeforeReceiptAndPublication: snapshot, logicalBytesBeforeReceiptAndPublication: logicalBytes, publicationReserveBytes: 1048576, actualProduct: false, actualWorkers: 0, unchangedBound: { logicalBytes: 332129069, uniqueCaptureBytes: 131072000, qualification: 'conditional prospective logical accounting, not OS disk/RSS/Git physical quota or fresh materialized-layout qualification' }, noRuntimeAuthority: true };
const receiptSha256 = save('RECEIPT.json', receipt);
console.log(JSON.stringify({ result, receiptSha256, logicalBytesBeforeReceiptAndPublication: logicalBytes, at: receipt.at }));
process.exitCode = fail ? 1 : 0;
