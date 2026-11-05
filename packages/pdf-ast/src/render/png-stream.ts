import { createByteCodec } from "@poe-code/compression";
import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function updatePngCrc(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return crc;
}

/** PNG stores physical resolution as integer pixels per metre. */
export function pngResolutionChunk(dpi: number, dpiY = dpi): Uint8Array {
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  view.setUint32(8, Math.min(0xffffffff, dpi / 0.0254));
  view.setUint32(12, Math.min(0xffffffff, dpiY / 0.0254));
  chunk[16] = 1;
  view.setUint32(17, (updatePngCrc(0xffffffff, chunk.subarray(4, 17)) ^ 0xffffffff) >>> 0);
  return chunk;
}

/** Filesystem-independent scanline conversion and DEFLATE; at most one raw
 * chunk and the shared codec's bounded state are retained. */
export async function* deflatePngPixels(width: number, height: number, input: AsyncIterable<Uint8Array>, opaque: boolean,
  chunkBytes: number, signal?: AbortSignal, colorMode: "rgb" | "gray" | "mono" = "rgb"): AsyncGenerator<Uint8Array, void, void> {
  const expected = width * height * 4;
  async function* scanlines(): AsyncGenerator<Uint8Array> {
    let position = 0; let used = 0; let buffer = new Uint8Array(chunkBytes); let work = 0;
    const append = (value: number): Uint8Array | undefined => {
      buffer[used++] = value;
      if (used !== buffer.length) return undefined;
      const result = buffer; buffer = new Uint8Array(chunkBytes); used = 0; return result;
    };
    let packed = 0;
    const sample = (value: number): Uint8Array | undefined => {
      if (!opaque || colorMode === "rgb") return !opaque || position % 4 !== 3 ? append(value) : undefined;
      if (position % 4 !== 0) return undefined;
      if (colorMode === "gray") return append(value);
      const x = (position / 4) % width;
      packed |= (value >= 128 ? 1 : 0) << (7 - (x & 7));
      if ((x & 7) !== 7 && x !== width - 1) return undefined;
      const chunk = append(packed); packed = 0; return chunk;
    };
    for await (const bytes of readBytes(input, signal)) {
      for (let at = 0; at < bytes.length && position < expected; at++, position++) {
        if (position % (width * 4) === 0) { const chunk = append(0); if (chunk) yield chunk; }
        { const chunk = sample(bytes[at]!); if (chunk) yield chunk; }
      }
      if (++work % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      if (position === expected) break;
    }
    while (position < expected) {
      if (position % (width * 4) === 0) { const chunk = append(0); if (chunk) yield chunk; }
      { const chunk = sample(0); if (chunk) yield chunk; }
      position++;
      if (position % (chunkBytes * 64) === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
    }
    if (used) yield buffer.slice(0, used);
  }
  const codec = createByteCodec({ direction: "encode", format: "zlib", chunkSize: chunkBytes });
  try {
    for await (const bytes of scanlines()) {
      signal?.throwIfAborted();
      for (const chunk of codec.push(bytes)) { signal?.throwIfAborted(); yield chunk; }
    }
    for (const chunk of codec.push(new Uint8Array(), true)) { signal?.throwIfAborted(); yield chunk; }
  } finally { codec.close(); }
}

/** Frame one known-length IDAT stream, preserving the buffered PNG layout. */
export async function* framePngChunks(width: number, height: number, opaque: boolean, length: number,
  compressed: AsyncIterable<Uint8Array>, chunkBytes: number, signal?: AbortSignal, dpi?: number, dpiY = dpi, colorMode: "rgb" | "gray" | "mono" = "rgb"): AsyncGenerator<Uint8Array, void, void> {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) throw new PdfError("E_LIMIT", "PNG IDAT length limit exceeded");
  const header = new Uint8Array(33); header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(header.buffer); view.setUint32(8, 13); header.set([73, 72, 68, 82], 12);
  view.setUint32(16, width); view.setUint32(20, height); header[24] = opaque && colorMode === "mono" ? 1 : 8; header[25] = opaque ? (colorMode === "rgb" ? 2 : 0) : 6;
  view.setUint32(29, (updatePngCrc(0xffffffff, header.subarray(12, 29)) ^ 0xffffffff) >>> 0);
  const idat = new Uint8Array(8); new DataView(idat.buffer).setUint32(0, length); idat.set([73, 68, 65, 84], 4);
  for (const part of [header, ...(dpi === undefined ? [] : [pngResolutionChunk(dpi, dpiY)]), idat]) for (let at = 0; at < part.length; at += chunkBytes) { signal?.throwIfAborted(); yield part.slice(at, at + chunkBytes); }
  let crc = updatePngCrc(0xffffffff, idat.subarray(4)); let read = 0;
  for await (const bytes of readBytes(compressed, signal)) {
    if (bytes.length > length - read) throw new PdfError("E_PARSE", "PNG compressed length mismatch");
    for (let at = 0; at < bytes.length; at += chunkBytes) {
      signal?.throwIfAborted(); const chunk = bytes.slice(at, at + chunkBytes); crc = updatePngCrc(crc, chunk); yield chunk;
    }
    read += bytes.length;
  }
  if (read !== length) throw new PdfError("E_PARSE", "PNG compressed length mismatch");
  const end = new Uint8Array(16); new DataView(end.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0);
  end.set([73, 69, 78, 68, 174, 66, 96, 130], 8);
  for (let at = 0; at < end.length; at += chunkBytes) { signal?.throwIfAborted(); yield end.slice(at, at + chunkBytes); }
}
