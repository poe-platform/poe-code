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

/** Shared range requests preserve the byte parser's permissive chunk semantics. */
export function* scanWavHeader(byteLength: number): Generator<{ offset: number; length: number }, WavHeader, Uint8Array> {
  if (byteLength < 12) throw new Error("Invalid WAV file: missing RIFF WAVE signature");
  const signature = yield { offset: 0, length: 12 };
  if (decodeFourCC(signature, 0) !== "RIFF" || decodeFourCC(signature, 8) !== "WAVE")
    throw new Error("Invalid WAV file: missing RIFF WAVE signature");
  const header: WavHeader = { byteLength, formatTag: 1, channels: 2, sampleRate: 44100, bitsPerSample: 16, dataOffset: 0, dataSize: 0 };
  let pos = 12;
  while (pos + 8 <= byteLength) {
    const chunk = yield { offset: pos, length: 8 };
    const id = decodeFourCC(chunk, 0), size = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
    const start = pos + 8, end = Math.min(byteLength, start + size);
    if (id === "fmt " && size >= 16) {
      const bytes = yield { offset: start, length: 16 };
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
    step = scan.next(bytes.subarray(offset, offset + length));
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
    step = scan.next(bytes);
  }
  signal?.throwIfAborted();
  return step.value;
}
