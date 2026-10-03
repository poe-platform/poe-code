import type { PdfRetainedPage } from "../retained-document.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedPageEvaluationOptions } from "../content/retained-page.js";
import { PdfFileSource } from "../source.js";
import { PdfStagingStorage } from "../staging-budget.js";
import { PdfError } from "../errors.js";
import { getBitmapCropRect, getDisplayListCropBox, renderOperationStreamWindow, type RenderToPngOptions } from "./raster.js";

export interface PdfRetainedPixelOptions extends Omit<RenderToPngOptions, "hideAnnotations">, PdfRetainedPageEvaluationOptions {
  readonly tileSize?: number;
  /** Driver scratch only; rasterizer window surfaces, evaluator resources and nested paint state are additional. */
  readonly maxPixelWorkingBytes?: number;
}
export interface PdfRetainedPixels {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA. Each yielded chunk is owned by the consumer. */
  readonly pixels: AsyncIterable<Uint8Array>;
}

/** Render one bounded window at a time into caller-backed tile storage, then
 * read transformed pixels without allocating the full page or collecting paints.
 * Replays page evaluation per tile; nested captures/resources retain their own
 * admission contracts. Storage is acquired lazily and owned by the iterator. */
export async function renderRetainedPagePixels(page: PdfRetainedPage, storage: PdfIndexStorage,
  options: PdfRetainedPixelOptions = {}): Promise<PdfRetainedPixels> {
  const { signal } = options; signal?.throwIfAborted();
  const tileSize = options.tileSize ?? 128, chunkBytes = options.chunkBytes ?? 65536;
  const maximum = options.maxPixelWorkingBytes ?? Infinity;
  if (!Number.isSafeInteger(tileSize) || tileSize < 1 || !Number.isSafeInteger(chunkBytes) || chunkBytes < 4
    || (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0))) throw new RangeError("Invalid retained pixel limits");
  const scratch = tileSize * tileSize * 4 + chunkBytes * 6;
  if (!Number.isSafeInteger(scratch) || scratch > maximum) throw new PdfError("E_LIMIT", "PDF pixel driver working byte limit exceeded");
  const attributes = await page.attributes(); signal?.throwIfAborted();
  const [x0, y0, x1, y1] = attributes.mediaBox;
  const geometry = { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), origin: [Math.min(x0, x1), Math.min(y0, y1)] as const };
  const baseScale = options.scale ?? (options.dpi ? options.dpi / 72 : 1.5);
  const scaleX = options.dpiX !== undefined ? options.dpiX / 72 : baseScale, scaleY = options.dpiY !== undefined ? options.dpiY / 72 : baseScale;
  const width = Math.max(1, Math.round(geometry.width * scaleX)), height = Math.max(1, Math.round(geometry.height * scaleX));
  const resample = Math.abs(scaleX - scaleY) > 1e-6;
  const targetHeight = resample ? Math.max(1, Math.round(geometry.height * scaleY)) : height;
  if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)
    || ![width, height, targetHeight, width * height * 4, width * targetHeight * 4].every(Number.isSafeInteger)) throw new RangeError("Invalid retained raster dimensions");
  let crop = { x: 0, y: 0, width, height: targetHeight };
  if (options.useCropBox) {
    const box = getDisplayListCropBox({ ...geometry, cropBox: [attributes.cropBox[0] - geometry.origin[0], attributes.cropBox[1] - geometry.origin[1], attributes.cropBox[2] - geometry.origin[0], attributes.cropBox[3] - geometry.origin[1]] });
    crop = getBitmapCropRect(width, targetHeight, { x: box[0] * scaleX, y: (geometry.height - box[3]) * scaleY, width: (box[2] - box[0]) * scaleX, height: (box[3] - box[1]) * scaleY });
  }
  const rotation = attributes.rotation, quarter = rotation === 90 || rotation === 270;
  const rotated = { width: quarter ? crop.height : crop.width, height: quarter ? crop.width : crop.height };
  const output = options.cropRect ? getBitmapCropRect(rotated.width, rotated.height, options.cropRect) : { x: 0, y: 0, ...rotated };
  const shared = new PdfStagingStorage(storage, options.maxStagingBytes);
  async function* pixels(): AsyncGenerator<Uint8Array, void, void> {
    let source: PdfFileSource | undefined, failed = false;
    async function* tiles() {
      let work = 0;
      for (let y = 0; y < height; y += tileSize) for (let x = 0; x < width; x += tileSize) {
        if (++work % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        const tile = await renderOperationStreamWindow(geometry, async function* () {
          for await (const event of page.evaluateSteps(shared, options)) if (!event.captured) yield event.operation;
        }, { x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) }, { ...options, scale: scaleX });
        yield tile.data;
      }
    }
    try {
      source = await PdfFileSource.fromStream(shared.fs, shared.directory, tiles(), { chunkBytes, cacheBytes: chunkBytes, ...(signal ? { signal } : {}) });
      let cached: Uint8Array = new Uint8Array(), cachedAt = -1, buffer = new Uint8Array(chunkBytes - chunkBytes % 4), used = 0, work = 0;
      for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
        if (++work % 16384 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted();
        const dx = x + output.x, dy = y + output.y;
        const cx = rotation === 90 ? dy : rotation === 180 ? crop.width - 1 - dx : rotation === 270 ? crop.width - 1 - dy : dx;
        const cy = rotation === 90 ? crop.height - 1 - dx : rotation === 180 ? crop.height - 1 - dy : rotation === 270 ? dx : dy;
        const sx = resample ? Math.min(width - 1, Math.floor(((crop.x + cx) / width) * width)) : crop.x + cx;
        const sy = resample ? Math.min(height - 1, Math.floor(((crop.y + cy) / targetHeight) * height)) : crop.y + cy;
        const tx = Math.floor(sx / tileSize) * tileSize, ty = Math.floor(sy / tileSize) * tileSize;
        const tw = Math.min(tileSize, width - tx), th = Math.min(tileSize, height - ty);
        const offset = (ty * width + tx * th + (sy - ty) * tw + sx - tx) * 4;
        for (let channel = 0; channel < 4; channel++) {
          const position = offset + channel;
          if (position < cachedAt || position >= cachedAt + cached.length) {
            cachedAt = Math.floor(position / chunkBytes) * chunkBytes; cached = await source.read(cachedAt, chunkBytes, signal);
          }
          buffer[used++] = cached[position - cachedAt]!;
        }
        if (used === buffer.length) { yield buffer; buffer = new Uint8Array(buffer.length); used = 0; }
      }
      if (used) yield buffer.subarray(0, used);
    } catch (error) { failed = true; throw error; }
    finally { try { await source?.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
  }
  return { width: output.width, height: output.height, pixels: pixels() };
}
