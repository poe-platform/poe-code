import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";
import type { PdfFilterDecodeParms } from "./filters.js";

export interface PdfPredictorOptions {
  readonly chunkBytes?: number;
  /** Intrinsic bytes per row, admitted before allocation or input reads. */
  readonly maxRowBytes?: number;
  readonly signal?: AbortSignal;
}

/** Decode predictors with two resident rows. Output chunks own their buffers;
 * incomplete final rows are discarded consistently with applyPredictor. */
export async function* decodePredictorChunks(input: AsyncIterable<Uint8Array>, parms: PdfFilterDecodeParms | undefined, options: PdfPredictorOptions = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxRowBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxRowBytes");
  const predictor = parms?.Predictor ?? 1;
  const { signal } = options;
  signal?.throwIfAborted();
  if (predictor <= 1) {
    for await (const chunk of readBytes(input, signal)) {
      for (let offset = 0; offset < chunk.length; offset += chunkBytes) { signal?.throwIfAborted(); yield chunk.slice(offset, offset + chunkBytes); }
    }
    return;
  }
  const colors = parms?.Colors ?? 1;
  const bits = parms?.BitsPerComponent ?? 8;
  const columns = parms?.Columns ?? 1;
  if (!Number.isSafeInteger(colors) || colors < 1 || !Number.isSafeInteger(columns) || columns < 1 || ![1, 2, 4, 8, 16].includes(bits)) {
    throw new PdfError("E_CAPABILITY", "Invalid PDF stream predictor parameters");
  }
  if (predictor !== 2 && (predictor < 10 || predictor > 15 || !Number.isInteger(predictor))) throw new PdfError("E_CAPABILITY", `Unsupported PDF predictor: ${predictor}`);
  const samples = colors * columns;
  const rowBits = samples * bits;
  const rowBytes = Math.ceil(rowBits / 8);
  if (!Number.isSafeInteger(rowBits) || rowBytes > maximum) throw new PdfError("E_LIMIT", "PDF predictor row byte limit exceeded");
  const pixelBytes = Math.max(1, Math.ceil(colors * bits / 8));
  const png = predictor !== 2;
  let row = new Uint8Array(rowBytes);
  let previous = new Uint8Array(png ? rowBytes : 0);
  let offset = 0;
  let filter: number | undefined = png ? undefined : 0;
  let turns = 0;
  for await (const chunk of readBytes(input, signal)) {
    let position = 0;
    while (position < chunk.length) {
      signal?.throwIfAborted();
      if (filter === undefined) filter = chunk[position++]!;
      const count = Math.min(rowBytes - offset, chunk.length - position);
      row.set(chunk.subarray(position, position + count), offset);
      offset += count; position += count;
      if (offset < rowBytes) continue;
      if (png) {
        if (filter > 4) throw new PdfError("E_CAPABILITY", `Invalid PNG row predictor type: ${filter}`);
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= pixelBytes ? row[i - pixelBytes]! : 0;
          const up = previous[i]!;
          const upLeft = i >= pixelBytes ? previous[i - pixelBytes]! : 0;
          let prediction = 0;
          if (filter === 1) prediction = left;
          else if (filter === 2) prediction = up;
          else if (filter === 3) prediction = (left + up) >>> 1;
          else if (filter === 4) {
            const value = left + up - upLeft;
            const a = Math.abs(value - left), b = Math.abs(value - up), c = Math.abs(value - upLeft);
            prediction = a <= b && a <= c ? left : b <= c ? up : upLeft;
          }
          row[i] = (row[i]! + prediction) & 255;
        }
      } else if (bits === 8) {
        for (let i = pixelBytes; i < rowBytes; i++) row[i] = (row[i]! + row[i - pixelBytes]!) & 255;
      } else if (bits === 16) {
        for (let i = pixelBytes; i + 1 < rowBytes; i += 2) {
          const value = ((row[i]! << 8) | row[i + 1]!) + ((row[i - pixelBytes]! << 8) | row[i - pixelBytes + 1]!);
          row[i] = value >>> 8 & 255; row[i + 1] = value & 255;
        }
      } else {
        const mask = (1 << bits) - 1;
        for (let sample = colors; sample < samples; sample++) {
          const currentBit = sample * bits, previousBit = (sample - colors) * bits;
          const currentByte = Math.floor(currentBit / 8), previousByte = Math.floor(previousBit / 8);
          const shift = 8 - bits - currentBit % 8;
          const value = (((row[currentByte]! >>> shift) & mask) + ((row[previousByte]! >>> (8 - bits - previousBit % 8)) & mask)) & mask;
          row[currentByte] = (row[currentByte]! & ~(mask << shift)) | (value << shift);
        }
        if (rowBits % 8) row[rowBytes - 1] = row[rowBytes - 1]! & (255 << (8 - rowBits % 8));
      }
      for (let i = 0; i < rowBytes; i += chunkBytes) { signal?.throwIfAborted(); yield row.slice(i, i + chunkBytes); }
      if (png) { const reusable = previous; previous = row; row = reusable; }
      offset = 0; filter = png ? undefined : 0;
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
}
