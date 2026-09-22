import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectTesseractRaster, TesseractError, type TesseractRaster } from './index.js';

const limits = { maxWidth: 4, maxHeight: 3, maxPixels: 12, maxWork: 12 };
const signal = new AbortController().signal;
function raster(changes: Partial<TesseractRaster> = {}): TesseractRaster {
  return { width: 2, height: 2, dpi: 300, pixels: new Uint8Array([0, 1, 1, 0]), format: 'binary8', ...changes };
}
function code(expected: string) {
  return (error: unknown) => error instanceof TesseractError && error.code === expected;
}

test('raster inspection admits tiny, blank and exact-limit planes without modifying bytes', () => {
  for (const image of [raster(), raster({ width: 1, height: 1, pixels: new Uint8Array([0]) }), raster({ width: 4, height: 3, pixels: new Uint8Array(12) })]) {
    const before = image.pixels.slice();
    assert.deepEqual(inspectTesseractRaster(image, limits, signal), { pixelCount: image.width * image.height, recognitionQualified: false });
    assert.deepEqual(image.pixels, before);
  }
  assert.equal(inspectTesseractRaster(raster({ format: 'gray8', pixels: new Uint8Array([0, 128, 254, 255]) }), limits, signal).pixelCount, 4);
});
test('dimensions and plane lengths are validated before pixel traversal', () => {
  for (const changes of [{ width: 0 }, { height: -1 }, { width: 1.5 }, { width: NaN }, { width: Number.MAX_SAFE_INTEGER, height: 2 }, { pixels: new Uint8Array(3) }, { pixels: new Uint8Array(5) }]) {
    assert.throws(() => inspectTesseractRaster(raster(changes), { ...limits, maxWidth: Number.MAX_SAFE_INTEGER }, signal), code('invalid-raster'));
  }
});
test('raster format, binary polarity domain and PPI have explicit admission', () => {
  for (const changes of [{ format: 'rgba8' as TesseractRaster['format'] }, { pixels: new Uint8Array([0, 255, 0, 0]) }, { dpi: 0 }, { dpi: 2401 }, { dpi: 12.5 }]) {
    assert.throws(() => inspectTesseractRaster(raster(changes), limits, signal), code('invalid-raster'));
  }
  const storage = new Uint8Array([255, 0, 1, 1, 0, 255]);
  assert.equal(inspectTesseractRaster(raster({ pixels: storage.subarray(1, 5) }), limits, signal).pixelCount, 4);
});
test('every raster limit is explicit, checked and enforced independently', () => {
  for (const key of ['maxWidth', 'maxHeight', 'maxPixels', 'maxWork'] as const) {
    assert.throws(() => inspectTesseractRaster(raster(), { ...limits, [key]: 1 }, signal), code('limit'));
    for (const value of [-1, NaN, Infinity, 1.5, undefined]) {
      assert.throws(() => inspectTesseractRaster(raster(), { ...limits, [key]: value } as typeof limits, signal), code('limit'));
    }
  }
});
test('pre-cancelled raster inspection refuses admission', () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => inspectTesseractRaster(raster(), limits, controller.signal), code('cancelled'));
});
test('validation reaches the final pixel beyond a cancellation checkpoint and rejects array-shaped storage', () => {
  const pixels = new Uint8Array(65537);
  pixels[65536] = 2;
  const image = raster({ width: 65537, height: 1, pixels });
  const large = { maxWidth: 65537, maxHeight: 1, maxPixels: 65537, maxWork: 65537 };
  assert.throws(() => inspectTesseractRaster(image, large, signal), code('invalid-raster'));
  pixels[65536] = 1;
  assert.equal(inspectTesseractRaster(image, large, signal).pixelCount, 65537);
  assert.throws(() => inspectTesseractRaster(raster({ pixels: { byteLength: 4, 0: 0, 1: 1, 2: 1, 3: 0 } as unknown as Uint8Array }), limits, signal), code('invalid-raster'));
});
