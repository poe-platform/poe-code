import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTesseractArguments, inspectTraineddata, TesseractError, createTesseractBudget } from './index.js';

test('outputbase consumes an option-like token and configs terminate options', () => {
  const parsed = parseTesseractArguments(['image.pbm', '--psm', 'txt', '--psm', '7']);
  assert.equal(parsed.outputbase, '--psm');
  assert.equal(parsed.psm, 3);
  assert.deepEqual(parsed.configs, ['txt', '--psm', '7']);
});
test('symbolic modes and assignment split preserve remaining equals', () => {
  const parsed = parseTesseractArguments(['image', 'out.txt', '--psm', 'raw_line', '--oem', 'lstm_only', '-c', 'key=a=b', 'tsv']);
  assert.equal(parsed.psm, 13);
  assert.equal(parsed.oem, 1);
  assert.deepEqual(parsed.variables, [{ name: 'key', value: 'a=b' }]);
  assert.equal(parsed.outputbase, 'out.txt');
});
test('safe parsing rejects permissive DPI, URLs, malformed assignments and invalid modes', () => {
  for (const args of [ ['image', 'out', '--dpi', '12tail'], ['https://example/image', 'out'], ['image', 'out', '-c', 'bad'], ['image', 'out', '--psm', '14'] ]) {
    assert.throws(() => parseTesseractArguments(args), TesseractError);
  }
});
test('help and SDK defaults are explicit, arguments have byte admission', () => {
  assert.equal(parseTesseractArguments([]).action, 'help');
  assert.equal(parseTesseractArguments(['--version']).action, 'version');
  assert.equal(parseTesseractArguments(['image', 'out'], { defaultPsm: 6 }).psm, 6);
  assert.throws(() => parseTesseractArguments(['image', 'out'], { maxArgumentBytes: 2 }), /argumentBytes/);
});
function container(offsets: bigint[], length: number, littleEndian = true): Uint8Array {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, offsets.length, littleEndian);
  offsets.forEach((offset, index) => view.setBigInt64(4 + index * 8, offset, littleEndian));
  return bytes;
}
test('traineddata container validates both endian profiles, missing components and exact extents', () => {
  for (const endian of [true, false]) {
    const result = inspectTraineddata(container([28n, -1n, 30n], 33, endian), { maxModelBytes: 100, maxComponents: 24 }, new AbortController().signal);
    assert.deepEqual(result.components, [{ index: 0, offset: 28, length: 2 }, { index: 2, offset: 30, length: 3 }]);
    assert.equal(result.littleEndian, endian);
    assert.equal(result.recognitionQualified, false);
  }
});
test('malformed model tables fail before any component allocation', () => {
  for (const bytes of [new Uint8Array(3), container([4n], 12), container([20n, 19n], 24), container([99n], 12), container([-2n], 12)]) {
    assert.throws(() => inspectTraineddata(bytes, { maxModelBytes: 100, maxComponents: 24 }, new AbortController().signal), TesseractError);
  }
});
test('model limits and cancellation are explicit', () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => inspectTraineddata(container([12n], 13), { maxModelBytes: 100, maxComponents: 24 }, controller.signal), /cancelled/);
  assert.throws(() => inspectTraineddata(container([12n], 13), { maxModelBytes: 12, maxComponents: 24 }, new AbortController().signal), /modelBytes/);
});
test('work reservations reject overflow and close releases invocation accounting', () => {
  const budget = createTesseractBudget({ work: 3, retainedBytes: 5 }, new AbortController().signal);
  budget.charge('work', 2); budget.charge('retainedBytes', 5);
  assert.throws(() => budget.charge('work', 2), /work/);
  assert.equal(budget.used('work'), 2);
  budget.release('retainedBytes', 5);
  assert.equal(budget.used('retainedBytes'), 0);
  assert.throws(() => budget.charge('work', Number.MAX_SAFE_INTEGER + 1), TesseractError);
  budget.close(); assert.equal(budget.used('work'), 0);
  assert.throws(() => budget.charge('work', 1), /closed/);
});
test('completed work cannot be refunded to bypass the invocation ceiling', () => {
  const budget = createTesseractBudget({ work: 3 }, new AbortController().signal);
  budget.charge('work', 3);
  assert.throws(() => budget.release('work', 3), error =>
    error instanceof TesseractError && error.code === 'limit' && error.resource === 'work');
  assert.equal(budget.used('work'), 3);
  assert.throws(() => budget.charge('work', 1), /work/);
  budget.close();
  assert.equal(budget.used('work'), 0);
});
test('bounded byte admission closes owned iterators on overflow and cancellation', async () => {
  const { readTesseractBytes } = await import('./index.js');
  let closed = 0;
  async function* input() { try { yield new Uint8Array([1, 2]); yield new Uint8Array([3]); } finally { closed += 1; } }
  assert.deepEqual(await readTesseractBytes(input(), 3, new AbortController().signal), new Uint8Array([1, 2, 3]));
  assert.equal(closed, 1);
  await assert.rejects(readTesseractBytes(input(), 2, new AbortController().signal), /inputBytes/);
  assert.equal(closed, 2);
  const controller = new AbortController();
  async function* cancelled() { try { yield new Uint8Array([1]); controller.abort(); yield new Uint8Array([2]); } finally { closed += 1; } }
  await assert.rejects(readTesseractBytes(cancelled(), 3, controller.signal), /cancelled/);
  assert.equal(closed, 3);
});
test('owned source cleanup runs once on success and retains read plus cleanup failures', async () => {
  const { readTesseractBytes } = await import('./index.js');
  let returned = 0;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { return { done: true as const, value: undefined }; },
    async return() { returned += 1; return { done: true as const, value: undefined }; }
  }; } };
  await readTesseractBytes(source, 1, new AbortController().signal);
  assert.equal(returned, 1);
  const broken = { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw 0; },
    async return(): Promise<IteratorResult<Uint8Array>> { throw 'cleanup'; }
  }; } };
  await assert.rejects(readTesseractBytes(broken, 1, new AbortController().signal), error => error instanceof AggregateError && error.errors[0] === 0 && error.errors[1] === 'cleanup');
});
test('native version alias and OSD language selection remain explicit', () => {
  assert.equal(parseTesseractArguments(['-v']).action, 'version');
  assert.equal(parseTesseractArguments(['image', 'out', '--psm', 'osd_only']).language, 'osd');
  assert.equal(parseTesseractArguments(['image', 'out', '--psm', '0', '-l', 'eng']).language, 'eng');
});
test('byte admission observes cancellation while awaiting iterator cleanup', async () => {
  const { readTesseractBytes } = await import('./index.js');
  const controller = new AbortController();
  let returned = 0;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { return { done: true as const, value: undefined }; },
    async return() {
      returned += 1;
      await Promise.resolve();
      controller.abort();
      return { done: true as const, value: undefined };
    },
  }; } };
  await assert.rejects(readTesseractBytes(source, 1, controller.signal), error =>
    error instanceof TesseractError && error.code === 'cancelled');
  assert.equal(returned, 1);
});
test('config PSM overrides CLI except native configured-six oddity', async () => {
  const { resolveTesseractPageSegMode } = await import('./index.js');
  assert.equal(resolveTesseractPageSegMode(3, 6), 3);
  assert.equal(resolveTesseractPageSegMode(7, 4), 4);
  assert.throws(() => resolveTesseractPageSegMode(99, 6), TesseractError);
});
