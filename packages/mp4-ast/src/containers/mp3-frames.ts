import { mpegFrame } from "@poe-code/audio-ast";
import type { MediaProbeSource } from "../types.js";

export interface Mp3Frame {
  offset: number;
  size: number;
  sampleRate: number;
  channels: number;
  samples: number;
  skipSamples: number;
  discardPadding: number;
}

/** Read bounded frame payloads; retain only packet boundaries, never encoded audio. */
function* scanMp3Frames(): Generator<{ offset: number; length: number }, Mp3Frame[], Uint8Array> {
  const frames: Mp3Frame[] = [];
  let offset = 0, first = true, skipSamples = 0, discardPadding = 0;
  while (true) {
    const bytes = yield { offset, length: 4 };
    if (!bytes.length) break;
    if (bytes.length < 4) throw new Error("Truncated MPEG frame");
    const marker = String.fromCharCode(...bytes.subarray(0, 3));
    if (marker === "ID3") {
      const tag = yield { offset: offset + 4, length: 6 };
      if (tag.length !== 6 || tag.subarray(2).some(b => b > 127)) throw new Error("Invalid ID3 header");
      const size = tag[2]! * 2097152 + tag[3]! * 16384 + tag[4]! * 128 + tag[5]!;
      offset += 10 + size + (bytes[3] === 4 && (tag[1]! & 16) ? 10 : 0);
      continue;
    }
    if (marker === "TAG") {
      const tag = yield { offset: offset + 4, length: 124 };
      if (tag.length !== 124) throw new Error("Truncated ID3v1 tag");
      offset += 128;
      continue;
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
    const frame = mpegFrame(header, offset, Infinity);
    const payload = yield { offset: offset + 4, length: frame.frameSize - 4 };
    if (payload.length !== frame.frameSize - 4) throw new Error("Truncated MPEG frame");
    const side = frame.version === 1 ? (frame.channels === 1 ? 17 : 32) : frame.channels === 1 ? 9 : 17;
    const xing = side + (header & 0x10000 ? 0 : 2);
    const text = (pos: number) => String.fromCharCode(...payload.subarray(pos, pos + 4));
    const metadata = first && (["Xing", "Info"].includes(text(xing)) || text(32) === "VBRI");
    if (metadata && ["Xing", "Info"].includes(text(xing)) && xing + 8 <= payload.length) {
      const flags = new DataView(payload.buffer, payload.byteOffset, payload.length).getUint32(xing + 4);
      const encoder = xing + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
      if (encoder + 24 <= payload.length && ["LAME", "Lavc", "Lavf"].includes(text(encoder))) {
        const delay = payload[encoder + 21]! * 16 + (payload[encoder + 22]! >>> 4);
        const padding = (payload[encoder + 22]! & 15) * 256 + payload[encoder + 23]!;
        // Layer III decoding adds 529 samples beyond the encoder's delay.
        skipSamples = delay + 529;
        discardPadding = Math.max(0, padding - 529);
      }
    }
    first = false;
    if (!metadata) frames.push({ offset, size: frame.frameSize, sampleRate: frame.rate, channels: frame.channels, samples: frame.count, skipSamples: 0, discardPadding: 0 });
    offset += frame.frameSize;
  }
  if (!frames.length) throw new Error("MP3 contains no MPEG frames");
  for (const frame of frames) {
    frame.skipSamples = Math.min(skipSamples, frame.samples);
    skipSamples -= frame.skipSamples;
  }
  for (let i = frames.length - 1; i >= 0 && discardPadding; i--) {
    const frame = frames[i]!;
    frame.discardPadding = Math.min(discardPadding, frame.samples - frame.skipSamples);
    discardPadding -= frame.discardPadding;
  }
  return frames;
}

export function readMp3Frames(bytes: Uint8Array): Mp3Frame[] {
  const scan = scanMp3Frames();
  let step = scan.next();
  while (!step.done) {
    const { offset, length } = step.value;
    step = scan.next(bytes.subarray(offset, offset + length));
  }
  return step.value;
}

export async function readMp3SourceFrames(source: MediaProbeSource, signal?: AbortSignal): Promise<Mp3Frame[]> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError("Invalid MP3 source size");
  const scan = scanMp3Frames();
  let step = scan.next();
  while (!step.done) {
    const { offset, length } = step.value;
    const bytes = new Uint8Array(Math.max(0, Math.min(length, source.size - offset)));
    let filled = 0;
    while (filled < bytes.length) {
      signal?.throwIfAborted();
      const chunk = await source.read(offset + filled, bytes.length - filled);
      signal?.throwIfAborted();
      if (!chunk.length || chunk.length > bytes.length - filled) throw new Error("Invalid MP3 source read");
      bytes.set(chunk, filled); filled += chunk.length;
    }
    step = scan.next(bytes);
  }
  signal?.throwIfAborted();
  return step.value;
}

export async function readMp3StreamFrames(source: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<{ frames: Mp3Frame[]; size: number }> {
  signal?.throwIfAborted();
  const scan = scanMp3Frames();
  let step = scan.next(), bytes = new Uint8Array(step.done ? 0 : step.value.length);
  let size = 0, filled = 0;
  let failure: { error: unknown } | undefined;
  for await (const chunk of source) {
    signal?.throwIfAborted();
    const start = size;
    size += chunk.byteLength;
    if (!Number.isSafeInteger(size)) throw new RangeError("Invalid MP3 source size");
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
        step = scan.next(bytes);
        bytes = new Uint8Array(step.done ? 0 : step.value.length);
        filled = 0;
      }
    } catch (error) { signal?.throwIfAborted(); failure = { error }; }
  }
  signal?.throwIfAborted();
  if (failure) throw failure.error;
  if (!step.done) step = scan.next(bytes.subarray(0, filled));
  if (!step.done) throw new Error("Truncated MP3 source");
  return { frames: step.value, size };
}
