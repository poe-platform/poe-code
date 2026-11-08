import type {PdfEvaluatedImage} from "../ast.js";
import {sampleImageLinear} from "./image-sampling.js";

/** Fixed range cache and caller-backed reduction levels. The source owner retains
 * all storage; borrowed reads are copied before another read can recycle them. */
export async function prepareRetainedImageSampler(image: PdfEvaluatedImage, widthScale: number, heightScale: number, signal?: AbortSignal) {
  const {storage} = image.storedRgba!;
  let position = image.storedRgba!.position, width = image.width, height = image.height;
  if (![position, width, height, width * height * 4, position + width * height * 4].every(Number.isSafeInteger) || position < 0 || width <= 0 || height <= 0) throw new RangeError("Invalid retained PDF image dimensions");
  const cache = new Map<number, Uint8Array>(), block = {width:2,height:2,data:new Uint8Array(16)};
  async function pixel(x:number,y:number,out:Uint8Array,at:number) {
    signal?.throwIfAborted();
    const offset = (y * width + x) * 4, page = Math.floor(offset / 4096), start = page * 4096;
    let bytes = cache.get(page);
    if (bytes) cache.delete(page);
    else {
      const length = Math.min(4096, width * height * 4 - start);
      const borrowed = await storage.read(position + start, length, signal ? {signal} : undefined); signal?.throwIfAborted();
      if (!(borrowed instanceof Uint8Array) || borrowed.length !== length) throw new Error("Truncated retained PDF pixels");
      bytes = new Uint8Array(borrowed);
      if (cache.size === 4) cache.delete(cache.keys().next().value!);
    }
    cache.set(page, bytes); out.set(bytes.subarray(offset - start, offset - start + 4), at);
  }
  async function linear(x:number,y:number,out:Float64Array) {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) await pixel(Math.min(width - 1, x0 + i), Math.min(height - 1, y0 + j), block.data, (j * 2 + i) * 4);
    sampleImageLinear(block, x - x0, y - y0, out);
  }
  const sample = new Float64Array(4), output = new Uint8Array(4096);
  while ((widthScale > 2 && width > 1) || (heightScale > 2 && height > 1)) {
    signal?.throwIfAborted();
    const nextWidth = widthScale > 2 ? Math.ceil(width / 2) : width, nextHeight = heightScale > 2 ? Math.ceil(height / 2) : height;
    const length = nextWidth * nextHeight * 4, nextPosition = storage.allocate(length);
    if (!Number.isSafeInteger(nextPosition) || nextPosition < 0 || !Number.isSafeInteger(nextPosition + length)) throw new RangeError("Invalid PDF reduction allocation");
    let used = 0, written = 0;
    for (let y = 0; y < nextHeight; y++) for (let x = 0; x < nextWidth; x++) {
      await linear((x + 0.5) * width / nextWidth - 0.5, (y + 0.5) * height / nextHeight - 0.5, sample);
      for (let c = 0; c < 4; c++) output[used++] = Math.round(sample[c]!);
      if (used === output.length) {
        await storage.write(nextPosition + written, output, signal ? {signal} : undefined); written += used; used = 0;
        if (written % 16384 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    if (used) await storage.write(nextPosition + written, output.subarray(0, used), signal ? {signal} : undefined);
    signal?.throwIfAborted();
    widthScale /= width / nextWidth; heightScale /= height / nextHeight;
    width = nextWidth; height = nextHeight; position = nextPosition; cache.clear();
  }
  return {
    async sample(u:number,v:number,smooth:boolean,out:Float64Array):Promise<void> {
      if (smooth) await linear(u * width - 0.5, (1 - v) * height - 0.5, out);
      else {
        await pixel(Math.min(width - 1, Math.max(0, Math.floor(u * width))), Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height))), block.data, 0);
        for (let c = 0; c < 4; c++) out[c] = block.data[c]!;
      }
    }
  };
}
