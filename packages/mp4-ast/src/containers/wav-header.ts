import type { MediaProbeSource } from "../types.js";
import { decodeFourCC } from "../binary.js";

export interface WavHeader {
  byteLength: number;
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

interface WavHeaderRead {
  bytes: Uint8Array;
  /** Actual length becomes known when a sequential source ends. */
  end?: number;
}

/** Shared range requests preserve the byte parser's permissive chunk semantics. */
export function* scanWavHeader(byteLength = Infinity): Generator<{ offset: number; length: number }, WavHeader, WavHeaderRead> {
  if (byteLength < 12) throw new Error("Invalid WAV file: missing RIFF WAVE signature");
  const signature = yield { offset: 0, length: 12 };
  if (signature.end !== undefined) byteLength = signature.end;
  if (signature.bytes.length < 12 || decodeFourCC(signature.bytes, 0) !== "RIFF" || decodeFourCC(signature.bytes, 8) !== "WAVE")
    throw new Error("Invalid WAV file: missing RIFF WAVE signature");
  const header: WavHeader = { byteLength, formatTag: 1, channels: 2, sampleRate: 44100, bitsPerSample: 16, dataOffset: 0, dataSize: 0 };
  const acceptEnd = (end: number | undefined) => {
    if (end === undefined) return;
    byteLength = end;
    header.byteLength = end;
    header.dataSize = Math.min(header.dataSize, Math.max(0, end - header.dataOffset));
  };
  let pos = 12;
  while (pos + 8 <= byteLength) {
    const read = yield { offset: pos, length: 8 };
    acceptEnd(read.end);
    if (pos + 8 > byteLength) break;
    const chunk = read.bytes;
    const id = decodeFourCC(chunk, 0), size = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
    const start = pos + 8, end = Math.min(byteLength, start + size);
    if (id === "fmt " && size >= 16) {
      const read = yield { offset: start, length: 16 };
      acceptEnd(read.end);
      const bytes = read.bytes;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      header.formatTag = view.getUint16(0, true);
      header.channels = view.getUint16(2, true) || 2;
      header.sampleRate = view.getUint32(4, true) || 44100;
      header.bitsPerSample = view.getUint16(14, true) || 16;
    } else if (id === "data") {
      header.dataOffset = start;
      header.dataSize = end - start;
    }
    pos = end + (size & 1);
  }
  return header;
}

export function readWavHeader(bytes: Uint8Array): WavHeader {
  const scan = scanWavHeader(bytes.byteLength);
  let step = scan.next();
  while (!step.done) {
    const { offset, length } = step.value;
    step = scan.next({ bytes: bytes.subarray(offset, offset + length) });
  }
  return step.value;
}

export async function readWavSourceHeader(source: MediaProbeSource, signal?: AbortSignal): Promise<WavHeader> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError("Invalid WAV source size");
  const scan = scanWavHeader(source.size);
  let step = scan.next();
  while (!step.done) {
    const { offset, length } = step.value;
    if (offset + length > source.size) throw new RangeError("Offset is outside the bounds of the DataView");
    const bytes = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      signal?.throwIfAborted();
      const chunk = await source.read(offset + filled, length - filled);
      signal?.throwIfAborted();
      if (chunk.length === 0) throw new Error("Unexpected end of WAV source");
      if (chunk.length > length - filled) throw new Error("WAV source returned more bytes than requested");
      bytes.set(chunk, filled); filled += chunk.length;
    }
    step = scan.next({ bytes });
  }
  signal?.throwIfAborted();
  return step.value;
}

/** Consume borrowed chunks once, retaining only the current <=16-byte header.
 * Parsing errors are deferred until admission completes, matching the buffered
 * path's precedence when an upstream reader fails after malformed input.
 */
export async function readWavStreamHeader(source: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<WavHeader> {
  signal?.throwIfAborted();
  const scan = scanWavHeader();
  let step = scan.next(), bytes = new Uint8Array(step.done ? 0 : step.value.length);
  let size = 0, filled = 0;
  let failure: { error: unknown } | undefined;
  for await (const chunk of source) {
    signal?.throwIfAborted();
    const start = size;
    size += chunk.byteLength;
    if (!Number.isSafeInteger(size)) throw new RangeError("Invalid WAV source size");
    if (failure) continue;
    try {
      while (!step.done && step.value.offset < size) {
        signal?.throwIfAborted();
        const request = step.value;
        const from = Math.max(start, request.offset + filled), end = Math.min(size, request.offset + request.length);
        if (end > from) {
          bytes.set(chunk.subarray(from - start, end - start), filled);
          filled += end - from;
        }
        if (filled < request.length) break;
        step = scan.next({ bytes });
        bytes = new Uint8Array(step.done ? 0 : step.value.length);
        filled = 0;
      }
    } catch (error) { signal?.throwIfAborted(); failure = { error }; }
  }
  signal?.throwIfAborted();
  if (failure) throw failure.error;
  if (!step.done) step = scan.next({ bytes: bytes.subarray(0, filled), end: size });
  if (!step.done) throw new Error("Unexpected WAV header request after end of source");
  return step.value;
}
