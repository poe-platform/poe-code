import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInflate, deflateSync } from 'node:zlib';
import { createWriter } from './writer-surrogate.mjs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Observer, comparePredicates, inspectState, notificationHorizon, reasonData, VERSION } from './observer.mjs';

const started = process.hrtime.bigint();
const controls = JSON.parse(await readFile(new URL('./CONTROLS.json', import.meta.url)));
const source = JSON.parse(await readFile(new URL('./SOURCE-DATA.json', import.meta.url)));
const correspondence = JSON.parse(await readFile(new URL('./CORRESPONDENCE.json', import.meta.url)));
const writerBytes = await readFile(new URL('./writer-surrogate.mjs', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
const receipt = { role: 'harmless-builtin-worker', version: VERSION, pid: process.pid, ppid: process.ppid,
  bornMonotonicNs: started.toString(), node: process.version, executable: process.execPath,
  candidateImports: 0, childSpawns: 0, syntheticTimersPending: 0 };
const emit = value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()));
await emit({ kind: 'birth', ...receipt });
assert.equal(process.version, 'v22.22.2');

async function bounded(promise, label, milliseconds = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label + ' timeout')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function report(observer, settlement, horizon) {
  return { settlement, horizon, comparison: comparePredicates(settlement, horizon), trace: observer.trace,
    maxima: { maxUnobservedNotifications: observer.maxUnobservedNotifications,
      maxNotClosed: observer.maxNotClosed, maxStatePending: observer.maxStatePending, maxRawCallbackNotifications: observer.maxRawCallbackNotifications },
    primaryIdentityPreserved: !observer.hasPrimary || observer.snapshot('identity').hasPrimary };
}

async function realCase(control) {
  const observer = new Observer(control.id);
  const resource = observer.reserve();
  try {
  const accepted = [];
  const input = control.kind === 'invalid' ? Buffer.from(control.constant) : deflateSync(Buffer.from(control.constant));
  const compressed = control.kind === 'truncated' ? Buffer.from(input.subarray(0, input.length - control.removeTailBytes)) : Buffer.from(input);
  if (control.kind === 'framing') compressed[compressed.length - 1] ^= control.xorLastByte;
  const headerFailure = new Error('independent oversized header refusal');
  let stream, writer, cleanup, settlement, primary, hasPrimary = false, closed;
  const output = [];
  let outputBytes = 0, cleanupAttempted = 0, operation = 'not-started';
  const closeOwned = () => cleanup ??= (async () => {
    cleanupAttempted++;
    try {
      if (stream) {
        if (resource.retirement) resource.retirement.destroyOwned(undefined); else stream.destroy();
        if (writer) await bounded(writer.catch(() => {}), 'owned writer cleanup');
        if (!stream.closed) await bounded(closed, 'owned close cleanup');
      }
      resource.cleanup = 'settled';
      observer.record('owned-cleanup-settled');
    } catch (reason) {
      resource.cleanup = 'rejected'; observer.failure(reason, 'owned-cleanup-rejection');
    }
  })();
  try {
    stream = createInflate({ chunkSize: 65536 });
    resource.stream = stream; resource.created = true;
    observer.attach(resource, stream);
    closed = new Promise(resolve => stream.once('close', resolve));
    if (control.kind === 'idle-destroy') {
      await closeOwned();
      settlement = observer.settle();
      operation = 'idle-destroy';
    } else {
      class GitFailure extends Error { constructor(message, status = 128) { super(message); this.status = status; } }
      const session = { check() {}, async step() {} };
      assert.ok(compressed.length < 4096, 'one small write per independent real fixture');
      const frozenWriter = createWriter(session, compressed, observer.writerCodec(resource), GitFailure);
      writer = observer.runOperation(resource, 'writer', frozenWriter);
      void writer.catch(reason => { accepted.push(reason); observer.record('writer-failure-observed'); });
      try {
        await bounded((async () => {
          for await (const value of resource.retirement.iterator()) {
            outputBytes += value.length;
            assert.ok(outputBytes <= 256, 'small harmless decompression only');
            output.push(Buffer.from(value));
            if (control.kind === 'header-cap') {
              assert.equal(Buffer.concat(output).toString(), 'blob 8388609\0');
              throw headerFailure;
            }
          }
        })(), 'owned consume');
        operation = 'fulfilled';
      } catch (reason) {
        hasPrimary = true; primary = reason; accepted.push(reason); observer.primaryFailure(reason);
        operation = 'rejected';
      }
    }
  } finally {
    await closeOwned();
  }
  if (!settlement) settlement = observer.settle(accepted);
  const horizon = await bounded(notificationHorizon(observer), 'notification horizon');
  const raw = { ...report(observer, settlement, horizon), fixture: { constant: control.constant, compressedHex: compressed.toString('hex'),
    outputHex: Buffer.concat(output).toString('hex') }, operation, hasPrimary, primary: reasonData(primary),
    hooks: resource.hookReceipt, ownedCleanup: { enrolledBeforeAcquisition: true, attempted: cleanupAttempted, settled: resource.cleanup === 'settled',
      actualClosed: stream.closed, actualDestroyed: stream.destroyed, closeDelivered: resource.closeDelivered,
      writePending: resource.writePending, endPending: resource.endPending, ownedOperationPending: resource.ownedOperationPending },
    safety: stream.closed !== true || !resource.closeDelivered || resource.cleanup !== 'settled' ||
      resource.ownedOperationPending !== 0 || observer.traceOverflow };
  const checks = [];
  try {
    if (control.kind === 'success') { assert.equal(hasPrimary, false); assert.equal(Buffer.concat(output).toString(), control.constant); }
    if (['invalid', 'truncated', 'framing'].includes(control.kind)) { assert.equal(hasPrimary, true); assert.match(primary.code, /^Z_/); }
    if (control.kind === 'header-cap') {
      assert.equal(primary, headerFailure); assert.equal(hasPrimary, true);
      assert.equal(resource.causes.length, 1);
      assert.equal(resource.causes[0].classification, 'source-linked-owned-iterator-return-observation');
      assert.ok(observer.failures.some(failure => failure.reason === resource.causes[0].reason && failure.acknowledged));
      assert.ok(resource.causes[0].enrolledSequence < observer.trace.find(event => event.event === 'stream-error').sequence);
      assert.equal(raw.comparison.atSettlement, 'NOTIFICATION_PENDING');
    }
    if (control.kind === 'invalid') {
      assert.equal(resource.operations[0].route, 'close-fallback');
      assert.equal(resource.operations[0].status, 'rejected');
      assert.equal(resource.ownedOperationPending, 0);
      assert.equal(resource.writePending, 1, 'missing raw callback retained diagnostically');
    }
    assert.equal(raw.comparison.proposedTerminal, control.expected);
    if (control.settlement) assert.equal(raw.comparison.atSettlement, control.settlement);
    assert.equal(raw.safety, false);
    checks.push('frozen expectations met');
  } catch (reason) { checks.push(reasonData(reason)); }
  return { ...raw, checks, passed: checks[0] === 'frozen expectations met' };
  } finally { observer.restoreHooks(resource); }
}

async function syntheticCase(control) {
  if (control.kind === 'late-error') return causalNegatives(control);
  if (control.kind === 'close-fallback-then-raw-callback') return fallbackCase(control);
  const observer = new Observer(control.id), resource = observer.reserve();
  Object.assign(resource, { created: true, destroyed: true, closed: true, cleanup: 'settled', destroyRequested: 1 });
  if (control.kind === 'destroyed-not-closed') resource.closed = false;
  if (control.kind === 'open') { resource.closed = false; resource.destroyed = false; resource.destroyRequested = 0; }
  let pendingOperation;
  if (control.kind === 'pending-write') { resource.writePending = 1; pendingOperation = observer.beginOperation(resource, 'write'); }
  if (control.kind === 'pending-end') { resource.endPending = 1; pendingOperation = observer.beginOperation(resource, 'end'); }
  if (control.kind === 'pending-cleanup') { resource.cleanup = 'pending'; resource.closeDelivered = true; }
  if (control.kind === 'unknown-state') resource.closed = undefined;
  if (control.kind === 'cleanup-reject-undefined') {
    observer.primaryFailure(undefined); resource.cleanup = 'rejected'; observer.failure(undefined, 'cleanup-rejection');
    assert.equal(observer.hasPrimary, true); assert.equal(observer.primary, undefined);
  }
  if (control.kind === 'falsy-primary-cleanup-null') {
    observer.primaryFailure(false); resource.cleanup = 'rejected'; observer.failure(null, 'cleanup-rejection');
    assert.equal(observer.hasPrimary, true); assert.equal(observer.primary, false);
  }
  observer.record('synthetic-before-outcome');
  const settlement = observer.settle();
  receipt.syntheticTimersPending++;
  await new Promise(resolve => setImmediate(() => {
    if (control.kind === 'late-error') { resource.error++; observer.failure(new Error('injected after outcome'), 'synthetic-late-error'); }
    if (['destroyed-not-closed', 'open'].includes(control.kind)) { resource.closed = true; resource.destroyed = true; }
    if (control.kind === 'pending-write') { resource.writePending = 0; resource.writeCallbacks++; }
    if (control.kind === 'pending-end') { resource.endPending = 0; resource.endCallbacks++; }
    if (pendingOperation) observer.finishOperation(resource, pendingOperation, 'fulfilled', 'synthetic-callback', undefined);
    if (control.kind === 'pending-cleanup') resource.cleanup = 'settled';
    resource.closeDelivered = true;
    observer.record('synthetic-close-delivered');
    receipt.syntheticTimersPending--; resolve();
  }));
  const horizon = await bounded(notificationHorizon(observer), 'synthetic horizon');
  const raw = report(observer, settlement, horizon);
  assert.equal(raw.comparison.atSettlement, control.settlement);
  assert.equal(raw.comparison.proposedTerminal, control.expected);
  if (control.kind === 'late-error') assert.equal(horizon.failures[0].late, true);
  if (control.kind === 'cleanup-reject-undefined') assert.equal(horizon.hasFailure, true);
  return { ...raw, passed: true, safety: false, physicalResources: 0, injectedWorkSettled: true };
}

async function fallbackCase(control) {
  const observer = new Observer(control.id), resource = observer.reserve();
  try {
  const stream = new EventEmitter(), expected = new Error('synthetic expected writer failure');
  Object.assign(stream, { closed: false, destroyed: false, readableEnded: false });
  let rawNotificationDone;
  const notification = new Promise(resolve => { rawNotificationDone = resolve; });
  stream.write = (bytes, callback) => {
    assert.equal(bytes.toString(), 'tiny');
    receipt.syntheticTimersPending++;
    process.nextTick(() => {
      stream.destroyed = true; stream.closed = true;
      stream.emit('error', expected); stream.emit('close');
    });
    setImmediate(() => {
      callback(expected); receipt.syntheticTimersPending--; rawNotificationDone();
    });
    return true;
  };
  stream.end = () => stream;
  stream.destroy = () => { stream.destroyed = true; return stream; };
  let writer, settlement;
  try {
    observer.attach(resource, stream);
    const isolated = createWriter({ check() {}, async step() {} }, Buffer.from('tiny'), observer.writerCodec(resource), Error);
    writer = observer.runOperation(resource, 'writer', isolated);
    try { await writer; assert.fail('expected source writer rejection'); }
    catch (reason) { assert.equal(reason, expected); observer.primaryFailure(reason); }
  } finally {
    stream.destroy();
    if (writer) await bounded(writer.catch(() => {}), 'synthetic owned writer');
    resource.cleanup = 'settled'; observer.record('synthetic-owned-cleanup-settled');
  }
  settlement = observer.settle([expected]);
  const horizon = await bounded(notificationHorizon(observer), 'synthetic fallback horizon');
  await bounded(notification, 'synthetic notification completion');
  const raw = report(observer, settlement, horizon);
  assert.equal(settlement.resources[0].writePending, 1);
  assert.equal(horizon.resources[0].writePending, 0);
  assert.equal(resource.operations.length, 1);
  assert.equal(resource.operations[0].status, 'rejected');
  assert.equal(resource.operations[0].route, 'close-fallback');
  assert.equal(resource.ownedOperationPending, 0);
  assert.equal(raw.comparison.atSettlement, control.settlement);
  assert.equal(raw.comparison.proposedTerminal, control.expected);
  assert.ok(horizon.failures.some(failure => failure.late && failure.acknowledged));
  return { ...raw, passed: true, safety: false, physicalResources: 0, injectedWorkSettled: true,
    sourceWriterUsed: true, primaryIdentityPreserved: observer.primary === expected, hooks: resource.hookReceipt };
  } finally { observer.restoreHooks(resource); }
}

async function causalNegatives(control) {
  const subcases = [];
  const abortShape = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
  for (const variant of control.variants) {
    const observer = new Observer(control.id + ':' + variant), resource = observer.reserve();
    const stream = new EventEmitter(), ownedReason = abortShape(), secondary = abortShape();
    assert.notEqual(ownedReason, secondary);
    Object.assign(stream, { closed: false, destroyed: false, write() { return true; }, end() { return this; } });
    stream.destroy = function (reason) {
      this.destroyed = true; this.closed = true;
      process.nextTick(() => { if (reason !== undefined) this.emit('error', reason); this.emit('close'); });
      return this;
    };
    const originalDescriptor = Object.getOwnPropertyDescriptor(stream, 'destroy');
    let injection;
    try {
      observer.attach(resource, stream);
      if (variant === 'owned-cause-plus-secondary') resource.retirement.destroyOwned(ownedReason);
      else stream.destroy();
      resource.cleanup = 'settled'; observer.record('synthetic-owned-resource-cleanup-settled');
      const settlement = observer.settle();
      receipt.syntheticTimersPending++;
      injection = new Promise(resolve => setImmediate(() => {
        if (variant === 'destroy-hook-tamper') {
          Object.defineProperty(stream, 'destroy', { ...Object.getOwnPropertyDescriptor(stream, 'destroy'), value() { return this; } });
          observer.record('injected-hook-tamper');
        } else {
          stream.emit('error', secondary);
        }
        receipt.syntheticTimersPending--; resolve();
      }));
      const horizon = await bounded(notificationHorizon(observer), 'causal negative notification horizon');
      await bounded(injection, 'causal injection completion');
      const raw = report(observer, settlement, horizon);
      assert.equal(raw.comparison.atSettlement, control.settlement);
      assert.equal(raw.comparison.proposedTerminal, control.expected);
      if (variant === 'destroy-hook-tamper') {
        assert.equal(horizon.resources[0].hookIntegrity, false);
        assert.ok(horizon.failures.some(failure => failure.channel === 'hook-tamper' && !failure.acknowledged));
      } else {
        const rejected = observer.failures.find(failure => failure.reason === secondary);
        assert.ok(rejected && rejected.late && !rejected.acknowledged && rejected.causeId === null);
        if (variant === 'owned-cause-plus-secondary') {
          const acknowledged = observer.failures.find(failure => failure.reason === ownedReason);
          assert.ok(acknowledged && acknowledged.acknowledged && acknowledged.causeId !== null);
          assert.notEqual(acknowledged.reasonId, rejected.reasonId);
          assert.equal(resource.causes.length, 1);
          assert.equal(resource.causes[0].reason, ownedReason);
          assert.equal(resource.causes[0].classification, 'direct-exact-owned-argument');
        } else assert.equal(resource.causes.length, 0);
      }
      subcases.push({ variant, ...raw, passed: true, hooks: resource.hookReceipt, physicalZlibStreams: 0,
        expectedReasonIdentityDistinct: ownedReason !== secondary });
    } finally {
      if (injection) await bounded(injection, 'finally causal injection');
      if (resource.closePromise) await bounded(resource.closePromise, 'finally synthetic close');
      observer.restoreHooks(resource);
      const restored = Object.getOwnPropertyDescriptor(stream, 'destroy');
      assert.equal(restored.value, originalDescriptor.value);
      assert.equal(restored.enumerable, originalDescriptor.enumerable);
      assert.equal(restored.configurable, originalDescriptor.configurable);
      assert.equal(restored.writable, originalDescriptor.writable);
    }
  }
  return { passed: true, safety: false, subcases, outerRows: 1, causalNegativeSubcases: 3, syntheticFacadeObjects: 3,
    physicalResources: 0, injectedWorkSettled: true, noAdditionalNativePasses: true };
}

function dataCase(control) {
  if (control.id === 'D01') {
    const original = { created: 289, closeDelivered: 288, semanticPasses: 69, unexecutedLayoutGroups: 215,
      maxUnobservedNotifications: 2, originalVerdict: 'H09 safety STOP', actualNewStates: 'not captured' };
    assert.ok(source.worker.text.includes("active.size !== 0"));
    assert.ok(source.handoff.text.includes('289'));
    assert.ok(source.handoff.text.includes('288'));
    assert.deepEqual(source.oldH09.nativeZlib, { created: 289, closed: 288, outstanding: 1, maxConcurrent: 2 });
    assert.equal(source.oldH09.safety, true);
    assert.equal(inspectState(original), 'UNKNOWN');
    return { original, oldPredicate: original.created - original.closeDelivered !== 0 ? 'HOLD' : 'CLEAR',
      proposedTerminal: 'HOLD', newStateClassification: 'UNKNOWN', noRescore: true, passed: true, safety: false };
  }
  assert.equal(sha(writerBytes), correspondence.surrogateSha256);
  const extracted = Buffer.from(source.codec.text).subarray(correspondence.writerStartByte, correspondence.writerEndByteExclusive);
  assert.equal(sha(extracted), correspondence.writerSha256);
  let transformed = extracted.toString();
  for (const change of correspondence.transformations) {
    assert.equal(transformed.split(change.from).length - 1, change.count);
    transformed = transformed.split(change.from).join(change.to);
  }
  assert.equal(writerBytes.toString(), correspondence.wrapperPrefix + transformed + correspondence.wrapperSuffix);
  assert.ok(transformed.includes('codec.once("close", closed);'));
  assert.ok(transformed.includes('codec.removeListener("close", closed);'));
  const codec = source.codec.text;
  const positions = ['codec.destroy();', 'await written?.catch(() => {});', 'if (!codec.closed)'].map(text => codec.lastIndexOf(text));
  assert.ok(positions[0] >= 0 && positions[0] < positions[1] && positions[1] < positions[2]);
  assert.ok(codec.includes('if (stream.closed) { resolve(); return; }'));
  assert.ok(source.output.text.includes('context.registerCleanup?.(close);'));
  assert.ok(source.output.text.indexOf('registerCleanup(dispose);') < source.output.text.indexOf('Promise.resolve(start(signal))'));
  return { sourceReadOnly: true, sourceSha256: source.codec.sha256, positions, executableCandidateImports: 0,
    writerCorrespondenceSha256: correspondence.writerSha256, dataAssertion: 'exact isolated writer type-erasure and cleanup order; not whole-codec execution', passed: true, safety: false };
}

let stopped = false;
for (const [role, rows] of [['real', controls.real], ['synthetic', controls.synthetic], ['data', controls.data]]) {
  for (const control of rows) {
    if (stopped) break;
    const caseStarted = process.hrtime.bigint();
    let row;
    try {
      row = role === 'real' ? await realCase(control) : role === 'synthetic' ? await syntheticCase(control) : dataCase(control);
    } catch (reason) {
      row = { passed: false, safety: true, failure: reasonData(reason), classification: 'HARNESS_OR_CLEANUP_FAILURE_NO_RETRY' };
    }
    const result = { kind: 'case', id: control.id, role, control, ...row, elapsedMs: Number(process.hrtime.bigint() - caseStarted) / 1e6 };
    const bytes = Buffer.byteLength(JSON.stringify(result));
    assert.ok(bytes < 256 * 1024, 'bounded case capture');
    await emit(result);
    results.push({ id: control.id, role, passed: row.passed, safety: row.safety });
    if (!row.passed || row.safety) stopped = true;
  }
}
await emit({ kind: 'summary', ...receipt, expected: 19, executed: results.length, results,
  unexecuted: [...controls.real, ...controls.synthetic, ...controls.data].filter(control => !results.some(result => result.id === control.id)).map(control => control.id),
  stopped, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6 });
process.exitCode = stopped ? 1 : 0;
