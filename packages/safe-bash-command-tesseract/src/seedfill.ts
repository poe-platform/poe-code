import { TesseractError, type TesseractRaster } from './contracts.js';
import { type createTesseractBudget } from './budget.js';
import { inspectTesseractRaster, type TesseractRasterLimits } from './raster.js';

/** Complete bounded reconstruction; intentionally rejects work exhaustion instead of native partial success. */
export function fillTesseractBinary(
  seed: TesseractRaster, mask: TesseractRaster, connectivity: 4 | 8,
  limits: TesseractRasterLimits, budget: ReturnType<typeof createTesseractBudget>, signal: AbortSignal
): { readonly raster: TesseractRaster; dispose(): void } {
  budget.checkpoint();
  if (connectivity !== 4 && connectivity !== 8) throw new TesseractError('invalid-argument', 'connectivity must be 4 or 8');
  if (seed.format !== 'binary8' || mask.format !== 'binary8' || seed.width !== mask.width || seed.height !== mask.height || seed.dpi !== mask.dpi) {
    throw new TesseractError('invalid-raster', 'seed and mask must be matching binary planes');
  }
  const count = mask.width * mask.height;
  if (!Number.isSafeInteger(count) || count < 1 || count > 0x3fffffff) throw new TesseractError('limit', 'seed fill plane exceeds index capacity', 'pixels');
  // Validation traversals are charged before inspecting any pixel.
  budget.charge('work', count * 2);
  inspectTesseractRaster(seed, limits, signal);
  inspectTesseractRaster(mask, limits, signal);
  let retained = 0, pixels = 0, output = 0;
  const dispose = () => {
    // A closed invocation has already discarded all reservations.
    if (retained && budget.used('retainedBytes')) budget.release('retainedBytes', retained);
    if (pixels && budget.used('pixels')) budget.release('pixels', pixels);
    if (output && budget.used('outputBytes')) budget.release('outputBytes', output);
    retained = 0; pixels = 0; output = 0;
  };
  try {
    budget.charge('retainedBytes', count * 5); retained = count * 5;
    budget.charge('pixels', count); pixels = count;
    budget.charge('outputBytes', count); output = count;
    const result = new Uint8Array(count), queue = new Uint32Array(count);
    let head = 0, tail = 0;
    for (let i = 0; i < count; i++) {
      budget.charge('work', 1);
      if (signal.aborted) throw new TesseractError('cancelled', 'seed fill cancelled');
      if (seed.pixels[i] && mask.pixels[i]) { result[i] = 1; queue[tail++] = i; }
    }
    while (head < tail) {
      const index = queue[head++]!, x = index % mask.width, y = Math.floor(index / mask.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        budget.charge('work', 1);
        if (signal.aborted) throw new TesseractError('cancelled', 'seed fill cancelled');
        if ((dx === 0 && dy === 0) || (connectivity === 4 && dx !== 0 && dy !== 0)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= mask.width || ny < 0 || ny >= mask.height) continue;
        const neighbor = ny * mask.width + nx;
        if (mask.pixels[neighbor] && !result[neighbor]) {
          result[neighbor] = 1; queue[tail++] = neighbor;
        }
      }
    }
    budget.release('retainedBytes', count * 4); retained = count;
    return { raster: { width: mask.width, height: mask.height, dpi: mask.dpi, format: 'binary8', pixels: result }, dispose };
  } catch (error) { dispose(); throw error; }
}
