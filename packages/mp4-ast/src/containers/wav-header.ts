import type { MediaProbeSource } from "../types.js";
import { decodeFourCC } from "../binary.js";

export interface WavHeader {
  byteLength: number;
  containerFormat: "wav" | "w64";
  formatTag: number;
  channels: number;
  channelMask?: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  formatOffset?: number;
  formatSize?: number;
  factOffset?: number;
  factSize?: number;
  dataOffset: number;
  dataSize: number;
  declaredDataSize?: number;
}

// Sony Wave64 GUIDs store the four-character chunk ID followed by this suffix.
export function wave64Guid(id: string): Uint8Array {
  return Uint8Array.of(...new TextEncoder().encode(id), ...(id === "riff"
    ? [0x2e, 0x91, 0xcf, 0x11, 0xa5, 0xd6, 0x28, 0xdb, 4, 0xc1, 0, 0]
    : [0xf3, 0xac, 0xd3, 0x11, 0x8c, 0xd1, 0, 0xc0, 0x4f, 0x8e, 0xdb, 0x8a]));
}

export function isWave64Signature(bytes: Uint8Array): boolean {
  return bytes.length >= 40 && wave64Guid("riff").every((value, i) => bytes[i] === value) &&
    wave64Guid("wave").every((value, i) => bytes[24 + i] === value);
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
  const wave64 = decodeFourCC(signature.bytes, 0) === "riff";
  if (wave64) {
    const read = yield { offset: 12, length: 28 };
    const bytes = new Uint8Array(40);
    bytes.set(signature.bytes);
    bytes.set(read.bytes, 12);
    if (read.bytes.length !== 28 || !isWave64Signature(bytes)) throw new Error("Invalid Wave64 signature");
    if (read.end !== undefined) byteLength = read.end;
    const size = Number(new DataView(bytes.buffer).getBigUint64(16, true));
    if (!Number.isSafeInteger(size) || size < 40 || size > byteLength) throw new Error("Invalid Wave64 file size");
    byteLength = size;
  } else if (signature.bytes.length < 12 || decodeFourCC(signature.bytes, 0) !== "RIFF" || decodeFourCC(signature.bytes, 8) !== "WAVE") {
    throw new Error("Invalid WAV file: missing RIFF WAVE signature");
  }
  const header: WavHeader = { byteLength, containerFormat: wave64 ? "w64" : "wav", formatTag: 1, channels: 2, sampleRate: 44100, bitsPerSample: 16, blockAlign: 4, dataOffset: 0, dataSize: 0 };
  const acceptEnd = (end: number | undefined) => {
    if (end === undefined) return;
    byteLength = end;
    header.byteLength = end;
    header.dataSize = Math.min(header.dataSize, Math.max(0, end - header.dataOffset));
  };
  const chunkHeader = wave64 ? 24 : 8;
  let pos = wave64 ? 40 : 12;
  while (pos + chunkHeader <= byteLength) {
    const read = yield { offset: pos, length: chunkHeader };
    acceptEnd(read.end);
    if (pos + chunkHeader > byteLength) break;
    const chunk = read.bytes;
    let id = decodeFourCC(chunk, 0);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const size = wave64 ? Number(view.getBigUint64(16, true)) - 24 : view.getUint32(4, true);
    if (wave64 && (!Number.isSafeInteger(size) || size < 0 || pos + chunkHeader + size > byteLength)) {
      throw new Error("Invalid Wave64 chunk size");
    }
    if (wave64 && !wave64Guid(id).every((value, i) => chunk[i] === value)) id = "";
    const start = pos + chunkHeader, end = Math.min(byteLength, start + size);
    if (id === "fmt " && size >= 16) {
      header.formatOffset = start;
      header.formatSize = end - start;
      const read = yield { offset: start, length: 16 };
      acceptEnd(read.end);
      const bytes = read.bytes;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      header.formatTag = view.getUint16(0, true);
      header.channels = view.getUint16(2, true) || 2;
      header.sampleRate = view.getUint32(4, true) || 44100;
      header.blockAlign = view.getUint16(12, true);
      header.bitsPerSample = view.getUint16(14, true) || 16;
      if (header.formatTag === 0xfffe) {
        if (size < 40) throw new Error("Invalid WAV extensible format");
        const extension = yield { offset: start + 16, length: 8 };
        acceptEnd(extension.end);
        const ext = new DataView(extension.bytes.buffer, extension.bytes.byteOffset, extension.bytes.byteLength);
        if (ext.getUint16(0, true) < 22) throw new Error("Invalid WAV extensible format");
        header.channelMask = ext.getUint32(4, true);
      }
    } else if (id === "fact") {
      header.factOffset = start;
      header.factSize = end - start;
    } else if (id === "data") {
      header.dataOffset = start;
      header.dataSize = end - start;
      header.declaredDataSize = size;
    }
    pos = end + (wave64 ? (8 - size % 8) % 8 : size & 1);
  }
  if (wave64 && (header.formatOffset === undefined || !header.dataOffset)) throw new Error("Missing Wave64 fmt or data chunk");
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

/** Consume borrowed chunks once, retaining only the current <=28-byte header.
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
  if (step.value.containerFormat === "w64" && step.value.byteLength > size) throw new Error("Truncated Wave64 stream");
  return step.value;
}
