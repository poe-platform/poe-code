import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morphTesseractBinary, createTesseractBudget, type TesseractRaster } from './index.js';

const signal = new AbortController().signal;
const limits = { maxWidth: 9, maxHeight: 7, maxPixels: 63, maxWork: 63 };
function plane(indices: readonly number[]): TesseractRaster {
  const pixels = new Uint8Array(63);
  for (const index of indices) pixels[index] = 1;
  return { width: 9, height: 7, dpi: 300, format: 'binary8', pixels };
}
function budget(overrides = {}, cancellation = signal) {
  return createTesseractBudget({ work: 10000, retainedBytes: 63, pixels: 63, outputBytes: 63, ...overrides }, cancellation);
}
function foreground(raster: TesseractRaster): number[] {
  return Array.from(raster.pixels.keys()).filter(index => raster.pixels[index] === 1);
}
test('even dilation anchor and odd square match pinned point controls', () => {
  const input = plane([31]);
  for (const [width, height, expected] of [
    [1, 1, [31]], [2, 1, [30, 31]], [3, 3, [21, 22, 23, 30, 31, 32, 39, 40, 41]], [6, 1, [28, 29, 30, 31, 32, 33]]
  ] as const) {
    const invocation = budget();
    const result = morphTesseractBinary(input, 'dilate', { width, height }, limits, invocation, signal);
    assert.deepEqual(foreground(result.raster), expected);
    assert.equal(invocation.used('work'), 63 * (1 + width * height));
    assert.equal(invocation.used('retainedBytes'), 63);
    assert.equal(invocation.used('pixels'), 63);
    assert.equal(invocation.used('outputBytes'), 63);
    result.dispose(); result.dispose();
    for (const resource of ['retainedBytes', 'pixels', 'outputBytes'] as const) assert.equal(invocation.used(resource), 0);
    invocation.close();
  }
  assert.deepEqual(foreground(input), [31]);
});
test('erosion treats outside pixels as off and uses floor brick origin', () => {
  const full = plane(Array.from({ length: 63 }, (_, index) => index));
  for (const [width, height, xmin, xmax, ymin, ymax] of [
    [1, 1, 0, 8, 0, 6], [2, 1, 1, 8, 0, 6], [3, 3, 1, 7, 1, 5], [6, 1, 3, 6, 0, 6]
  ] as const) {
    const invocation = budget();
    const result = morphTesseractBinary(full, 'erode', { width, height }, limits, invocation, signal);
    const expected: number[] = [];
    for (let y = ymin; y <= ymax; y++) for (let x = xmin; x <= xmax; x++) expected.push(y * 9 + x);
    assert.deepEqual(foreground(result.raster), expected);
    result.dispose(); invocation.close();
  }
});
test('left-edge dilation clips and gap-row erosion does not bridge holes', () => {
  const invocation = budget();
  const edge = morphTesseractBinary(plane([0, 9, 18, 27, 36, 45, 54]), 'dilate', { width: 2, height: 1 }, limits, invocation, signal);
  assert.deepEqual(foreground(edge.raster), [0, 9, 18, 27, 36, 45, 54]); edge.dispose();
  const gap = morphTesseractBinary(plane([27, 28, 29, 30, 32, 33, 34, 35]), 'erode', { width: 2, height: 1 }, limits, invocation, signal);
  assert.deepEqual(foreground(gap.raster), [28, 29, 30, 33, 34, 35]); gap.dispose(); invocation.close();
});
test('tiny planes accept oversized bricks, blank planes stay blank, and work is exact', () => {
  for (const operation of ['dilate', 'erode'] as const) {
    const invocation = budget({ work: 10 });
    const input: TesseractRaster = { ...plane([]), width: 1, height: 1, pixels: new Uint8Array([1]) };
    const result = morphTesseractBinary(input, operation, { width: 3, height: 3 }, limits, invocation, signal);
    assert.deepEqual(Array.from(result.raster.pixels), [operation === 'dilate' ? 1 : 0]);
    assert.equal(invocation.used('work'), 10);
    result.dispose(); invocation.close();
    const blankBudget = budget();
    const blank = morphTesseractBinary(plane([]), operation, { width: 6, height: 1 }, limits, blankBudget, signal);
    assert.deepEqual(foreground(blank.raster), []); blank.dispose(); blankBudget.close();
  }
});
test('unsafe kernel products fail before allocation', () => {
  const invocation = budget();
  assert.throws(() => morphTesseractBinary(plane([]), 'dilate',
    { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
    { ...limits, maxWidth: Number.MAX_SAFE_INTEGER, maxHeight: Number.MAX_SAFE_INTEGER }, invocation, signal),
  { code: 'limit', resource: 'work' });
  assert.equal(invocation.used('retainedBytes'), 0); invocation.close();
});
test('invalid operation, bricks, format and pixels fail without owned allocations', () => {
  const invocation = budget();
  for (const width of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => morphTesseractBinary(plane([]), 'dilate', { width, height: 1 }, limits, invocation, signal));
  }
  assert.throws(() => morphTesseractBinary(plane([]), 'open' as 'dilate', { width: 1, height: 1 }, limits, invocation, signal), { code: 'invalid-argument' });
  assert.throws(() => morphTesseractBinary({ ...plane([]), format: 'gray8' }, 'erode', { width: 1, height: 1 }, limits, invocation, signal), { code: 'invalid-raster' });
  const invalid = plane([]); invalid.pixels[62] = 2;
  assert.throws(() => morphTesseractBinary(invalid, 'erode', { width: 1, height: 1 }, limits, invocation, signal), { code: 'invalid-raster' });
  assert.equal(invocation.used('retainedBytes'), 0); invocation.close();
});
test('reservation failures and work exhaustion preserve existing resources', () => {
  for (const overrides of [{ work: 125 }, { retainedBytes: 63 }, { pixels: 63 }, { outputBytes: 63 }]) {
    const invocation = budget(overrides);
    for (const resource of ['retainedBytes', 'pixels', 'outputBytes'] as const) invocation.charge(resource, 1);
    assert.throws(() => morphTesseractBinary(plane([]), 'erode', { width: 1, height: 1 }, limits, invocation, signal), { code: 'limit' });
    for (const resource of ['retainedBytes', 'pixels', 'outputBytes'] as const) assert.equal(invocation.used(resource), 1);
    invocation.close();
  }
});
test('explicit and invocation cancellation, closed budget, and cleanup after close', () => {
  const controller = new AbortController(); controller.abort();
  for (const [invocation, cancellation] of [[budget(), controller.signal], [budget({}, controller.signal), signal]] as const) {
    assert.throws(() => morphTesseractBinary(plane([]), 'dilate', { width: 1, height: 1 }, limits, invocation, cancellation), { code: 'cancelled' });
    assert.equal(invocation.used('retainedBytes'), 0); invocation.close();
  }
  let checks = 0;
  const controlled = { get aborted() { return ++checks > 20; } } as AbortSignal;
  const invocation = budget();
  assert.throws(() => morphTesseractBinary(plane([31]), 'dilate', { width: 3, height: 3 }, limits, invocation, controlled), { code: 'cancelled' });
  for (const resource of ['retainedBytes', 'pixels', 'outputBytes'] as const) assert.equal(invocation.used(resource), 0);
  const result = morphTesseractBinary(plane([]), 'erode', { width: 1, height: 1 }, limits, invocation, signal);
  invocation.close(); assert.doesNotThrow(() => result.dispose());
  assert.throws(() => morphTesseractBinary(plane([]), 'erode', { width: 1, height: 1 }, limits, invocation, signal), { code: 'closed' });
});
