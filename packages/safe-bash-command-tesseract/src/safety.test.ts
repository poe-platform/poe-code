import assert from 'node:assert/strict';
import test from 'node:test';
import { createTesseractBudget, readTesseractBytes, parseTesseractArguments, TesseractError } from './index.js';

// Independent stream partitions; no image decoder or recognition capability is implied.
test('byte admission preserves all byte values across seeded partitions and owns cleanup', async () => {
  const expected = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);
  let seed = 0x5afe, closed = 0;
  async function* source() {
    try {
      for (let offset = 0; offset < expected.length;) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const end = Math.min(expected.length, offset + 1 + seed % 31);
        yield expected.subarray(offset, end); offset = end;
      }
    } finally { closed++; }
  }
  assert.deepEqual(await readTesseractBytes(source(), expected.length, new AbortController().signal), expected);
  assert.equal(closed, 1);
  await assert.rejects(readTesseractBytes(source(), expected.length - 1, new AbortController().signal), /inputBytes/);
  assert.equal(closed, 2);
});

test('empty chunks cannot evade the stream work ceiling; falsey errors survive cleanup', async () => {
  let returned = 0;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: new Uint8Array() }; },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  await assert.rejects(readTesseractBytes(source, 0, new AbortController().signal, 3), error =>
    error instanceof TesseractError && error.resource === 'inputChunks');
  assert.equal(returned, 1);
  const broken = { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw false; },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  await assert.rejects(readTesseractBytes(broken, 0, new AbortController().signal), error => error === false);
  assert.equal(returned, 2);
});

test('pending cooperative input aborts without returning partial bytes and drains exactly once', async () => {
  const controller = new AbortController();
  let started!: () => void, returned = 0;
  const acquired = new Promise<void>(resolve => { started = resolve; });
  const reason = new Error('denied pending read');
  const source = { [Symbol.asyncIterator]() { return {
    next(): Promise<IteratorResult<Uint8Array>> {
      started();
      return new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(reason), { once: true }));
    },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  const pending = readTesseractBytes(source, 4, controller.signal);
  const rejected = assert.rejects(pending, error => error === reason);
  await acquired; controller.abort(reason); await rejected;
  assert.equal(returned, 1);
});

test('budget denial rolls back counts and disposal allows memory cleanup after cancellation', () => {
  const controller = new AbortController();
  const budget = createTesseractBudget({ retainedBytes: 4, work: 1 }, controller.signal);
  budget.charge('retainedBytes', 4);
  for (const amount of [1, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => budget.charge('retainedBytes', amount), TesseractError);
    assert.equal(budget.used('retainedBytes'), 4);
  }
  assert.throws(() => budget.charge('pixels', 0), /pixels/);
  controller.abort();
  assert.throws(() => budget.charge('work', 1), /cancelled/);
  budget.release('retainedBytes', 4);
  budget.close(); budget.close();
  assert.equal(budget.used('retainedBytes'), 0);
  assert.throws(() => budget.checkpoint(), /closed/);
});

test('hostile argv has exact UTF8 admission, no NUL/surrogate coercion or implicit URLs', () => {
  assert.equal(parseTesseractArguments(['é', 'x'], { maxArgumentBytes: 5 }).input, 'é');
  assert.throws(() => parseTesseractArguments(['é', 'x'], { maxArgumentBytes: 4 }), /argumentBytes/);
  for (const operand of ['a\0b', '\ud800', '\udfff', 'file://etc/passwd', 'https://example.invalid']) {
    assert.throws(() => parseTesseractArguments([operand, 'out']), TesseractError);
  }
  for (const dpi of ['0', '2401', '12tail', '-1', 'Infinity', ' 300']) {
    assert.throws(() => parseTesseractArguments(['image', 'out', '--dpi', dpi]), TesseractError);
  }
});

test('foreign realm byte chunks fail explicitly and still close the owned source', async () => {
  const { runInNewContext } = await import('node:vm');
  const foreign: Uint8Array = runInNewContext('Uint8Array.of(0, 255)');
  let closed = 0;
  async function* source() { try { yield foreign; } finally { closed++; } }
  await assert.rejects(readTesseractBytes(source(), 2, new AbortController().signal), error =>
    error instanceof TesseractError && error.code === 'invalid-argument');
  assert.equal(closed, 1);
});
