import { TesseractError, type TesseractRaster } from './contracts.js';

export interface TesseractRasterLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxWork: number;
}

/** Inspect a caller-owned plane without copies or I/O. No decoding or OCR qualification. */
export function inspectTesseractRaster(raster: TesseractRaster, limits: TesseractRasterLimits, signal: AbortSignal): {
  readonly pixelCount: number;
  readonly recognitionQualified: false;
} {
  const check = () => {
    if (signal.aborted) throw new TesseractError('cancelled', 'raster inspection cancelled');
  };
  check();
  for (const key of ['maxWidth', 'maxHeight', 'maxPixels', 'maxWork'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new TesseractError('limit', 'invalid raster limit: ' + key, key);
  }
  const invalid = () => new TesseractError('invalid-raster', 'invalid raster dimensions, pixels, format or DPI');
  if (!Number.isSafeInteger(raster.width) || raster.width < 1 || !Number.isSafeInteger(raster.height) || raster.height < 1 ||
      raster.width > Math.floor(Number.MAX_SAFE_INTEGER / raster.height)) throw invalid();
  const pixelCount = raster.width * raster.height;
  if (!(raster.pixels instanceof Uint8Array) || raster.pixels.byteLength !== pixelCount ||
      (raster.format !== 'gray8' && raster.format !== 'binary8') ||
      !Number.isInteger(raster.dpi) || raster.dpi < 1 || raster.dpi > 2400) throw invalid();
  for (const [resource, amount, maximum] of [
    ['width', raster.width, limits.maxWidth], ['height', raster.height, limits.maxHeight],
    ['pixels', pixelCount, limits.maxPixels], ['work', pixelCount, limits.maxWork]
  ] as const) {
    if (amount > maximum) throw new TesseractError('limit', 'exhausted raster ' + resource, resource);
  }
  // One charged validation step per pixel; checkpoints bound traversal to 65,536 steps.
  for (let start = 0; start < pixelCount; start += 65536) {
    check();
    if (raster.format === 'binary8') {
      const end = Math.min(start + 65536, pixelCount);
      for (let index = start; index < end; index += 1) {
        if (raster.pixels[index]! > 1) throw invalid();
      }
    }
  }
  check();
  return { pixelCount, recognitionQualified: false };
}
