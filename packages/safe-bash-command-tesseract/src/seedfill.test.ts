import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTesseractBinary, createTesseractBudget, TesseractError, type TesseractRaster } from './index.js';

const signal = new AbortController().signal;
function image(width: number, height: number, pixels = new Uint8Array(width * height)): TesseractRaster {
  return { width, height, pixels, dpi: 300, format: 'binary8' };
}
const limits = { maxWidth: 129, maxHeight: 321, maxPixels: 41409, maxWork: 41409 };
function budget(overrides = {}) {
  return createTesseractBudget({ pixels: 41409, retainedBytes: 207045, outputBytes: 41409, work: 500000, ...overrides }, signal);
}
test('diagonal reconstruction distinguishes four/eight connectivity and owns its output', () => {
  const mask = image(9, 9);
  for (let i = 0; i < 9; i++) mask.pixels[i * 10] = 1;
  const seed = image(9, 9); seed.pixels[0] = 1;
  for (const connectivity of [4, 8] as const) {
    const invocation = budget();
    const result = fillTesseractBinary(seed, mask, connectivity, limits, invocation, signal);
    assert.equal(result.raster.pixels.reduce((a, b) => a + b, 0), connectivity === 4 ? 1 : 9);
    assert.equal(invocation.used('retainedBytes'), 81);
    assert.equal(invocation.used('outputBytes'), 81);
    assert.equal(invocation.used('pixels'), 81);
    assert.notEqual(result.raster.pixels, mask.pixels);
    result.dispose(); result.dispose();
    assert.equal(invocation.used('retainedBytes'), 0);
    assert.equal(invocation.used('pixels'), 0);
    assert.equal(invocation.used('outputBytes'), 0);
    assert.ok(invocation.used('work') > 0);
    invocation.close();
  }
  assert.equal(seed.pixels.reduce((a, b) => a + b, 0), 1);
});
test('cross-word serpentine masks reconstruct completely rather than native partial success', () => {
  for (const width of [9, 33, 65, 129]) for (const height of [21, 81, 161, 321]) {
    const mask = image(width, height), seed = image(width, height); seed.pixels[0] = 1;
    for (let y = 0; y < height; y++) {
      if (y % 2 === 0) mask.pixels.fill(1, y * width, (y + 1) * width);
      else mask.pixels[y * width + (Math.floor(y / 2) % 2 === 0 ? width - 1 : 0)] = 1;
    }
    for (const connectivity of [4, 8] as const) {
      const invocation = budget();
      const result = fillTesseractBinary(seed, mask, connectivity, limits, invocation, signal);
      assert.deepEqual(result.raster.pixels, mask.pixels);
      result.dispose(); invocation.close();
    }
  }
});
test('empty seeds succeed, outside-mask seeds are clipped and mismatched planes fail', () => {
  const invocation = budget();
  const result = fillTesseractBinary(image(1, 1, new Uint8Array([1])), image(1, 1), 4, limits, invocation, signal);
  assert.deepEqual(result.raster.pixels, new Uint8Array([0])); result.dispose();
  assert.throws(() => fillTesseractBinary(image(1, 1), image(2, 1), 4, limits, invocation, signal), { code: 'invalid-raster' });
  invocation.close();
});
test('every reservation and algorithm exhaustion rolls back owned memory without partial success', () => {
  for (const overrides of [{ retainedBytes: 19 }, { pixels: 3 }, { outputBytes: 3 }, { work: 8 }, { work: 12 }]) {
    const invocation = budget(overrides);
    const plane = image(2, 2, new Uint8Array([1, 1, 1, 1]));
    assert.throws(() => fillTesseractBinary(plane, plane, 8, limits, invocation, signal), (error: unknown) => error instanceof TesseractError && error.code === 'limit');
    for (const resource of ['retainedBytes', 'pixels', 'outputBytes'] as const) assert.equal(invocation.used(resource), 0);
    invocation.close();
  }
});
test('cancelled invocations and unsupported connectivity fail before allocation', () => {
  const controller = new AbortController(); controller.abort();
  const invocation = createTesseractBudget({}, controller.signal);
  assert.throws(() => fillTesseractBinary(image(1, 1), image(1, 1), 4, limits, invocation, signal), { code: 'cancelled' });
  const live = budget();
  assert.throws(() => fillTesseractBinary(image(1, 1), image(1, 1), 6 as 4, limits, live, signal), { code: 'invalid-argument' });
  live.close(); invocation.close();
});
test('cancellation during reconstruction rolls back all owned reservations', () => {
  let checks = 0;
  const controlled = { get aborted() { return ++checks > 15; } } as AbortSignal;
  const invocation = budget();
  const plane = image(9, 9, new Uint8Array(81).fill(1));
  assert.throws(() => fillTesseractBinary(plane, plane, 8, limits, invocation, controlled), { code: 'cancelled' });
  for (const resource of ['retainedBytes', 'pixels', 'outputBytes'] as const) assert.equal(invocation.used(resource), 0);
  invocation.close();
});
test('output cleanup remains safe after the invocation closes', () => {
  const invocation = budget();
  const result = fillTesseractBinary(image(1, 1), image(1, 1), 4, limits, invocation, signal);
  invocation.close();
  assert.doesNotThrow(() => result.dispose());
});
