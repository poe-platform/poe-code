import { createByteCodec } from "@poe-code/compression";
import { readBytes } from "@poe-code/safe-fs/contracts";
import { encodeJpegChunks } from "./jpeg-stream.js";
import type { TiffCompressionMode } from "./raster.js";

export function createTiffHeader(width: number, height: number, dpi: number, compressionTag: number, stripLength: number): Uint8Array {
  const numEntries = compressionTag === 7 ? 13 : 12;
  const ifdOffset = 8;
  const ifdByteLength = 2 + numEntries * 12 + 4;
  const bitsPerSampleOffset = ifdOffset + ifdByteLength;
  const xResOffset = bitsPerSampleOffset + 6;
  const yResOffset = xResOffset + 8;
  const stripOffset = yResOffset + 8;

  const out = new Uint8Array(stripOffset);
  const view = new DataView(out.buffer);

  // Little-endian TIFF 6.0 header ('II' + 42 + IFD offset 8)
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, numEntries, true);
  let pos = ifdOffset + 2;
  const writeEntry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(pos, tag, true);
    view.setUint16(pos + 2, type, true);
    view.setUint32(pos + 4, count, true);
    if (type === 3 && count === 1) {
      view.setUint16(pos + 8, valueOrOffset, true);
      view.setUint16(pos + 10, 0, true);
    } else {
      view.setUint32(pos + 8, valueOrOffset, true);
    }
    pos += 12;
  };

  const resolvedDpi = Math.max(1, Math.round(dpi));
  writeEntry(256, 4, 1, width); // ImageWidth
  writeEntry(257, 4, 1, height); // ImageLength
  writeEntry(258, 3, 3, bitsPerSampleOffset); // BitsPerSample -> [8, 8, 8]
  writeEntry(259, 3, 1, compressionTag); // Compression
  writeEntry(262, 3, 1, compressionTag === 7 ? 6 : 2); // PhotometricInterpretation = 2 (RGB)
  writeEntry(273, 4, 1, stripOffset); // StripOffsets
  writeEntry(277, 3, 1, 3); // SamplesPerPixel = 3
  writeEntry(278, 4, 1, height); // RowsPerStrip
  writeEntry(279, 4, 1, stripLength); // StripByteCounts
  writeEntry(282, 5, 1, xResOffset); // XResolution
  writeEntry(283, 5, 1, yResOffset); // YResolution
  writeEntry(296, 3, 1, 2); // ResolutionUnit = 2 (Inch)
  if (compressionTag === 7) writeEntry(530, 3, 2, 0x00010001); // YCbCr subsampling 1:1
  view.setUint32(pos, 0, true); // Next IFD offset = 0

  // BitsPerSample [8, 8, 8]
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);

  // XResolution & YResolution rationals
  view.setUint32(xResOffset, resolvedDpi, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, resolvedDpi, true);
  view.setUint32(yResOffset + 4, 1, true);

  return out;
}

export function *encodePackBitsRowSteps(row: Uint8Array): Generator<void, number[], void> {
  let work = 0;
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    if (++work % 16384 === 0) yield;
    let runLen = 1;
    while (i + runLen < row.length && runLen < 128 && row[i + runLen] === row[i]) {
    if (++work % 16384 === 0) yield;
      runLen++;
    }
    if (runLen >= 2) {
      out.push((257 - runLen) & 0xff, row[i]!);
      i += runLen;
    } else {
      const litStart = i;
      let litLen = 0;
      while (i < row.length && litLen < 128) {
    if (++work % 16384 === 0) yield;
        if (i + 1 < row.length && row[i + 1] === row[i]) break;
        i++;
        litLen++;
      }
      out.push(litLen - 1);
      for (let k = 0; k < litLen; k++) {
    if (++work % 16384 === 0) yield;
        out.push(row[litStart + k]!);
      }
    }
  }
  return out;
}


async function* rgbRows(width: number, height: number, input: AsyncIterable<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  let position = 0; let row = new Uint8Array(width * 3); const expected = width * height * 4;
  for await (const bytes of readBytes(input, signal)) {
    for (let at = 0; at < bytes.length && position < expected; at++, position++) {
      const channel = position % 4;
      if (channel < 3) row[Math.floor(position % (width * 4) / 4) * 3 + channel] = bytes[at]!;
      if ((position + 1) % (width * 4) === 0) { yield row; row = new Uint8Array(width * 3); }
      if (position % 65536 === 65535) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
    }
  }
  while (position < expected) {
    const take = Math.min(expected - position, width * 4 - position % (width * 4)); position += take;
    yield row; row = new Uint8Array(width * 3);
  }
}

/** TIFF/PDF early-change LZW with at most 3837 numeric prefix transitions. */
async function* lzwChunks(input: AsyncIterable<Uint8Array>, chunkBytes: number, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const dictionary = new Map<number, number>(); let nextCode = 258, codeSize = 9, prefix: number | undefined;
  let bitBuffer = 0, bitCount = 0, used = 0; let output = new Uint8Array(chunkBytes);
  function* write(code: number): Generator<Uint8Array> {
    bitBuffer = (bitBuffer << codeSize) | code; bitCount += codeSize;
    while (bitCount >= 8) {
      bitCount -= 8; output[used++] = (bitBuffer >>> bitCount) & 255;
      if (used === chunkBytes) { yield output; output = new Uint8Array(chunkBytes); used = 0; }
    }
  }
  yield* write(256);
  for await (const bytes of input) for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (prefix === undefined) { prefix = byte; continue; }
    const key = prefix * 256 + byte; const found = dictionary.get(key);
    if (found !== undefined) prefix = found;
    else {
      yield* write(prefix); dictionary.set(key, nextCode++);
      if (nextCode === 512 || nextCode === 1024 || nextCode === 2048) codeSize++;
      else if (nextCode >= 4095) { yield* write(256); dictionary.clear(); nextCode = 258; codeSize = 9; }
      prefix = byte;
    }
    if (i % 16384 === 16383) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
  }
  if (prefix !== undefined) yield* write(prefix);
  yield* write(257);
  if (bitCount > 0) output[used++] = (bitBuffer << (8 - bitCount)) & 255;
  if (used) yield output.slice(0, used);
}

/** Pure strip encoding; callers admit row/codec state and own output staging. */
export async function* encodeTiffStripChunks(width: number, height: number, input: AsyncIterable<Uint8Array>, compression: TiffCompressionMode,
  chunkBytes: number, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (compression === "jpeg") { yield* encodeJpegChunks(width, height, input, { chunkBytes, ...(signal ? { signal } : {}) }); return; }
  const rows = rgbRows(width, height, input, signal);
  if (compression === "lzw") { yield* lzwChunks(rows, chunkBytes, signal); return; }
  const codec = compression === "deflate" ? createByteCodec({ direction: "encode", format: "zlib", chunkSize: chunkBytes }) : undefined;
  try {
    for await (const row of rows) {
      signal?.throwIfAborted();
      if (compression === "packbits") {
        const steps = encodePackBitsRowSteps(row); let step = steps.next();
        while (!step.done) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); step = steps.next(); }
        for (let at = 0; at < step.value.length; at += chunkBytes) yield Uint8Array.from(step.value.slice(at, at + chunkBytes));
      } else for (let at = 0; at < row.length; at += chunkBytes) {
        const bytes = row.subarray(at, at + chunkBytes);
        if (codec) { for (const compressed of codec.push(bytes)) yield compressed; }
        else yield bytes.slice();
      }
    }
    if (codec) for (const bytes of codec.push(new Uint8Array(), true)) yield bytes;
  } finally { codec?.close(); }
}
