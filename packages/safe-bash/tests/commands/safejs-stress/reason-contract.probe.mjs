import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const nativeAbortMessage = AbortSignal.abort().reason.message;
const { run } = await import(pathToFileURL(join(process.env.SAFEJS_LOCAL_ROOT, 'src/run.ts')).href);

async function rejection(source, options) {
  const promise = run(source, options);
  assert.equal(typeof promise?.then, 'function');
  try {
    await promise;
  } catch (reason) {
    return reason;
  }
  assert.fail('Expected rejection');
}

function assertAbortEnvelope(error, reason) {
  assert.notEqual(error, reason);
  assert.equal(error.name, 'AbortError');
  assert.equal(error.message, nativeAbortMessage);
  assert.equal(error.stack, `AbortError: ${nativeAbortMessage}`);
  assert.equal(error.cause, reason);
  assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
  assert.deepEqual(error.span.start, { line: 1, column: 1, offset: 0 });
}

for (const reason of [null, false, 0, -0, '', 'custom primitive reason', 7n, Symbol('cancel')]) {
  test(`preserves primitive ${String(reason)} exactly`, async () => {
    const error = await rejection('return 42;', { signal: AbortSignal.abort(reason) });
    assert(Object.is(error, reason));
  });
}

for (const label of ['default', 'frozen-default', 'custom-error', 'frozen-error', 'frozen-record', 'frozen-function']) {
  test(`shapes ${label} with untouched exact cause`, async () => {
    const innerCause = Object.freeze({ internal: 'original cause' });
    const customError = new Error('custom cancellation', { cause: innerCause });
    customError.name = 'UserSpecificCancellation';
    const reason = label === 'default' || label === 'frozen-default'
      ? AbortSignal.abort().reason
      : label === 'frozen-record' ? Object.freeze({ code: 42, innerCause })
      : label === 'frozen-function' ? Object.freeze(function cancellationReason() {})
      : customError;
    if (label.startsWith('frozen-')) Object.freeze(reason);
    const before = Object.getOwnPropertyDescriptors(reason);
    const error = await rejection('return 42;', { signal: AbortSignal.abort(reason) });
    assertAbortEnvelope(error, reason);
    assert.deepEqual(Object.getOwnPropertyDescriptors(reason), before);
    if (label === 'custom-error' || label === 'frozen-error') {
      assert.equal(error.cause.message, 'custom cancellation');
      assert.equal(error.cause.name, 'UserSpecificCancellation');
      assert.equal(error.cause.cause, innerCause);
    }
  });
}

test('does not read reason getters, stringify it, or traverse its prototype', async () => {
  let reads = 0;
  const failRead = () => { reads += 1; throw new Error('caller property accessed'); };
  const prototype = Object.create(null);
  for (const property of ['name', 'message', 'stack', 'cause', 'span', 'toJSON', 'toString', Symbol.toPrimitive]) {
    Object.defineProperty(prototype, property, { get: failRead });
  }
  const reason = Object.freeze(Object.create(prototype));
  const error = await rejection('return 42;', { signal: AbortSignal.abort(reason) });
  assertAbortEnvelope(error, reason);
  assert.equal(reads, 0);
});

test('does not touch own reason accessors or stack formatting hooks', async () => {
  let reads = 0;
  const reason = new Error('lazy stack reason');
  for (const property of ['name', 'message', 'stack', 'cause', 'span']) {
    Object.defineProperty(reason, property, {
      get() { reads += 1; throw new Error(`read ${property}`); }, configurable: true,
    });
  }
  Object.freeze(reason);
  const previous = Error.prepareStackTrace;
  Error.prepareStackTrace = () => { reads += 1; throw new Error('prepared stack'); };
  try {
    const error = await rejection('return 42;', { signal: AbortSignal.abort(reason) });
    assertAbortEnvelope(error, reason);
    assert.equal(reads, 0);
  } finally {
    Error.prepareStackTrace = previous;
  }
});

test('does not inspect caller options or run setup before rejection', async () => {
  let reads = 0;
  const reason = Object.freeze(new Error('cancel before setup'));
  const options = { signal: AbortSignal.abort(reason) };
  for (const property of ['bindings', 'modules', 'budget', 'snapshot', 'snapshotBackend', 'otelSink', 'sink', 'filename', 'random', 'clock', 'entryPointArgs', 'importMeta', 'hostCallResumeProvider']) {
    Object.defineProperty(options, property, {
      get() { reads += 1; throw new Error(`setup ${property}`); },
    });
  }
  assertAbortEnvelope(await rejection('not valid JS !!!', options), reason);
  assert.equal(reads, 0);
});

test('entry span stays valid for empty, multiline, and invalid source', async () => {
  for (const source of ['', '\nreturn 42;', 'not valid JS !!!']) {
    const reason = Object.freeze(new Error('cancel'));
    const error = await rejection(source, { signal: AbortSignal.abort(reason) });
    assertAbortEnvelope(error, reason);
    assert.equal(error.span.end.offset, Math.min(source.length, 1));
    assert.equal(error.span.end.line, source.startsWith('\n') ? 2 : 1);
    assert.equal(error.span.end.column, source.startsWith('\n') || source.length === 0 ? 1 : 2);
  }
});
