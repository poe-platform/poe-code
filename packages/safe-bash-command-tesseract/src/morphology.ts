import { TesseractError, type TesseractRaster } from './contracts.js';
import { type createTesseractBudget } from './budget.js';
import { inspectTesseractRaster, type TesseractRasterLimits } from './raster.js';

/** Rectangular binary morphology with Leptonica's asymmetric (outside-off) boundary. */
export function morphTesseractBinary(
  input: TesseractRaster, operation: 'dilate' | 'erode',
  brick: { readonly width: number; readonly height: number },
  limits: TesseractRasterLimits, budget: ReturnType<typeof createTesseractBudget>, signal: AbortSignal
): { readonly raster: TesseractRaster; dispose(): void } {
  budget.checkpoint();
  if (signal.aborted) throw new TesseractError('cancelled', 'morphology cancelled');
  if (operation !== 'dilate' && operation !== 'erode') throw new TesseractError('invalid-argument', 'operation must be dilate or erode');
  if (!Number.isSafeInteger(brick.width) || brick.width < 1 || !Number.isSafeInteger(brick.height) || brick.height < 1) {
    throw new TesseractError('invalid-argument', 'brick dimensions must be positive safe integers');
  }
  // Brick dimensions share the explicit raster dimension ceilings. No kernel allocation.
  if (brick.width > limits.maxWidth || brick.height > limits.maxHeight) throw new TesseractError('limit', 'brick exceeds dimension limits');
  if (input.format !== 'binary8') throw new TesseractError('invalid-raster', 'morphology requires a binary plane');
  const count = input.width * input.height;
  if (!Number.isSafeInteger(count) || count < 1) throw new TesseractError('invalid-raster', 'invalid pixel count');
  budget.charge('work', count);
  inspectTesseractRaster(input, limits, signal);
  const area = brick.width * brick.height;
  if (!Number.isSafeInteger(area) || area > Math.floor(Number.MAX_SAFE_INTEGER / count)) {
    throw new TesseractError('limit', 'morphology work exceeds safe accounting', 'work');
  }
  // Charge every sample, even outside the image, before allocation. No refunded work.
  budget.charge('work', count * area);
  let retained = 0, pixels = 0, output = 0;
  const dispose = () => {
    if (retained && budget.used('retainedBytes')) budget.release('retainedBytes', retained);
    if (pixels && budget.used('pixels')) budget.release('pixels', pixels);
    if (output && budget.used('outputBytes')) budget.release('outputBytes', output);
    retained = 0; pixels = 0; output = 0;
  };
  try {
    budget.charge('retainedBytes', count); retained = count;
    budget.charge('pixels', count); pixels = count;
    budget.charge('outputBytes', count); output = count;
    const result = new Uint8Array(count);
    // Dilation reflects the brick; even-sized origins therefore differ from erosion.
    const originX = operation === 'erode' ? Math.floor(brick.width / 2) : brick.width - 1 - Math.floor(brick.width / 2);
    const originY = operation === 'erode' ? Math.floor(brick.height / 2) : brick.height - 1 - Math.floor(brick.height / 2);
    for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
      let value = operation === 'erode' ? 1 : 0;
      for (let by = 0; by < brick.height; by++) for (let bx = 0; bx < brick.width; bx++) {
        budget.checkpoint();
        if (signal.aborted) throw new TesseractError('cancelled', 'morphology cancelled');
        const sx = x + bx - originX, sy = y + by - originY;
        const sample = sx < 0 || sx >= input.width || sy < 0 || sy >= input.height ? 0 : input.pixels[sy * input.width + sx]!;
        value = operation === 'erode' ? value & sample : value | sample;
      }
      result[y * input.width + x] = value;
    }
    return { raster: { width: input.width, height: input.height, dpi: input.dpi, format: 'binary8', pixels: result }, dispose };
  } catch (error) { dispose(); throw error; }
}
