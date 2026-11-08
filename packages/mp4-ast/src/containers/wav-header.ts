import type { MediaProbeSource, Mp4MetadataTags } from "../types.js";
import { decodeFourCC } from "../binary.js";

export const wavInfoTags = {
  INAM: "title", IART: "artist", IPRD: "album", ICRD: "date", ICMT: "comment",
  IGNR: "genre", ISFT: "encoder", ITRK: "trackNumber", ICOP: "copyright"
} as const;

export interface WavHeader {
  metadata?: Mp4MetadataTags;

  byteLength: number;
  littleEndian: boolean;
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
  cues?: { id: number; start: number; title: string }[];
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
  const rf64 = decodeFourCC(signature.bytes, 0) === "RF64";
  const littleEndian = decodeFourCC(signature.bytes, 0) !== "RIFX";
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
  } else if (signature.bytes.length < 12 || (littleEndian && !rf64 && decodeFourCC(signature.bytes, 0) !== "RIFF") || decodeFourCC(signature.bytes, 8) !== "WAVE") {
    throw new Error("Invalid WAV file: missing RIFF WAVE signature");
  }
  let riffEnd = Infinity, rf64DataSize: number | undefined;
  const sizes: { id: string; size: number }[] = [];
  let pos = wave64 ? 40 : 12;
  if (rf64) {
    const chunk = yield { offset: 12, length: 8 };
    if (chunk.bytes.length !== 8 || decodeFourCC(chunk.bytes, 0) !== "ds64") throw new Error("RF64 requires ds64 chunk");
    const size = new DataView(chunk.bytes.buffer, chunk.bytes.byteOffset, 8).getUint32(4, true);
    if (size < 28 || size > byteLength - 20) throw new Error("Invalid RF64 ds64 size");
    const read = yield { offset: 20, length: 28 };
    if (read.bytes.length !== 28) throw new Error("Truncated RF64 ds64 chunk");
    const ds64 = new DataView(read.bytes.buffer, read.bytes.byteOffset, 28);
    riffEnd = Number(ds64.getBigUint64(0, true)) + 8;
    rf64DataSize = Number(ds64.getBigUint64(8, true));
    pos = 20 + size + (size & 1);
    if (!Number.isSafeInteger(riffEnd) || riffEnd < pos || riffEnd > byteLength || !Number.isSafeInteger(rf64DataSize))
      throw new Error("Invalid RF64 file or data size");
    const count = ds64.getUint32(24, true);
    if (count > Math.floor((size - 28) / 12)) throw new Error("Invalid RF64 ds64 table size");
    for (let index = 0; index < count; index++) {
      const entry = yield { offset: 48 + index * 12, length: 12 };
      if (entry.bytes.length !== 12) throw new Error("Truncated RF64 ds64 table");
      const size = Number(new DataView(entry.bytes.buffer, entry.bytes.byteOffset, 12).getBigUint64(4, true));
      if (!Number.isSafeInteger(size)) throw new Error("Invalid RF64 chunk size");
      sizes.push({ id: decodeFourCC(entry.bytes, 0), size });
    }
  }
  const header: WavHeader = { littleEndian, byteLength: Math.min(byteLength, riffEnd), containerFormat: wave64 ? "w64" : "wav", formatTag: 1, channels: 2, sampleRate: 44100, bitsPerSample: 16, blockAlign: 4, dataOffset: 0, dataSize: 0 };
  const acceptEnd = (end: number | undefined) => {
    if (end === undefined) return;
    if (rf64 && end < riffEnd) throw new Error("Truncated RF64 stream");
    byteLength = end;
    header.byteLength = Math.min(end, riffEnd);
    header.dataSize = Math.min(header.dataSize, Math.max(0, end - header.dataOffset));
  };
  const labels = new Map<number, string>();
  const chunkHeader = wave64 ? 24 : 8;
  while (pos + chunkHeader <= Math.min(byteLength, riffEnd)) {
    const read = yield { offset: pos, length: chunkHeader };
    acceptEnd(read.end);
    if (pos + chunkHeader > byteLength) break;
    const chunk = read.bytes;
    let id = decodeFourCC(chunk, 0);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let size = wave64 ? Number(view.getBigUint64(16, littleEndian)) - 24 : view.getUint32(4, littleEndian);
    if (rf64 && size === 0xffffffff) {
      if (id === "data" && rf64DataSize !== undefined) {
        size = rf64DataSize;
        rf64DataSize = undefined;
      } else {
        const index = sizes.findIndex(entry => entry.id === id);
        if (index < 0) throw new Error("Missing RF64 chunk size");
        size = sizes.splice(index, 1)[0]!.size;
      }
    }
    if (rf64 && size + (size % 2) > riffEnd - pos - chunkHeader) throw new Error("Invalid RF64 chunk bounds");
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
      header.formatTag = view.getUint16(0, littleEndian);
      header.channels = view.getUint16(2, littleEndian) || 2;
      header.sampleRate = view.getUint32(4, littleEndian) || 44100;
      header.blockAlign = view.getUint16(12, littleEndian);
      header.bitsPerSample = view.getUint16(14, littleEndian) || 16;
      if (header.formatTag === 0xfffe) {
        if (size < 40) throw new Error("Invalid WAV extensible format");
        const extension = yield { offset: start + 16, length: 8 };
        acceptEnd(extension.end);
        const ext = new DataView(extension.bytes.buffer, extension.bytes.byteOffset, extension.bytes.byteLength);
        if (ext.getUint16(0, littleEndian) < 22) throw new Error("Invalid WAV extensible format");
        header.channelMask = ext.getUint32(4, littleEndian);
      }
    } else if (!wave64 && id === "cue ") {
      if (size < 4) throw new Error("Invalid WAV cue chunk");
      const countRead = yield { offset: start, length: 4 };
      const count = new DataView(countRead.bytes.buffer, countRead.bytes.byteOffset, countRead.bytes.byteLength).getUint32(0, littleEndian);
      if (count > Math.floor((end - start - 4) / 24)) throw new Error("Invalid WAV cue count");
      for (let index = 0; index < count; index++) {
        const read = yield { offset: start + 4 + index * 24, length: 24 };
        const cue = new DataView(read.bytes.buffer, read.bytes.byteOffset, read.bytes.byteLength);
        (header.cues ??= []).push({ id: cue.getUint32(0, littleEndian), start: cue.getUint32(20, littleEndian), title: "" });
      }
    } else if (!wave64 && id === "bext" && size >= 602) {
      const read = yield { offset: start, length: 346 };
      const text = (offset: number, length: number) => new TextDecoder().decode(read.bytes.subarray(offset, offset + length)).split("\0")[0]!;
      const custom: Record<string, string> = { ...header.metadata?.custom,
        time_reference: new DataView(read.bytes.buffer, read.bytes.byteOffset, read.bytes.byteLength).getBigUint64(338, true).toString()
      };
      for (const [key, offset, length] of [["encoded_by", 256, 32], ["originator_reference", 288, 32], ["creation_time", 330, 8]] as const) {
        const value = text(offset, length);
        if (value) custom[key] = value;
      }
      if (size > 602) {
        const decoder = new TextDecoder();
        let history = "";
        for (let offset = start + 602; offset < end; offset += 16384) {
          const read = yield { offset, length: Math.min(16384, end - offset) };
          history += decoder.decode(read.bytes, { stream: true });
        }
        history = (history + decoder.decode()).split("\0")[0]!;
        if (history) custom.coding_history = history;
      }
      header.metadata = {
        ...header.metadata,
        ...(text(0, 256) ? { comment: text(0, 256) } : {}),
        ...(text(320, 10) ? { date: text(320, 10) } : {}),
        custom
      };
    } else if (!wave64 && id === "LIST" && size >= 4) {
      const list = yield { offset: start, length: 4 };
      if (decodeFourCC(list.bytes, 0) === "INFO") {
        for (let offset = start + 4; offset + 8 <= end;) {
          const read = yield { offset, length: 8 };
          const id = decodeFourCC(read.bytes, 0);
          const length = new DataView(read.bytes.buffer, read.bytes.byteOffset, read.bytes.byteLength).getUint32(4, littleEndian);
          if (length > end - offset - 8) throw new Error("WAV INFO exceeds LIST bounds");
          const decoder = new TextDecoder();
          let value = "";
          for (let pos = 0; pos < length; pos += 16384) {
            const text = yield { offset: offset + 8 + pos, length: Math.min(16384, length - pos) };
            value += decoder.decode(text.bytes, { stream: true });
          }
          value = (value + decoder.decode()).split("\0")[0]!;
          const key = wavInfoTags[id as keyof typeof wavInfoTags];
          header.metadata = key ? { ...header.metadata, [key]: value }
            : { ...header.metadata, custom: { ...header.metadata?.custom, [id === "ITCH" ? "encoded_by" : id]: value } };
          offset += 8 + length + (length & 1);
        }
      } else if (decodeFourCC(list.bytes, 0) === "adtl") {
        for (let offset = start + 4; offset + 8 <= end;) {
          const read = yield { offset, length: 8 };
          const sub = new DataView(read.bytes.buffer, read.bytes.byteOffset, read.bytes.byteLength);
          const length = sub.getUint32(4, littleEndian);
          if (length > end - offset - 8) throw new Error("WAV adtl exceeds LIST bounds");
          if (decodeFourCC(read.bytes, 0) === "labl" && length >= 4) {
            const key = yield { offset: offset + 8, length: 4 };
            const id = new DataView(key.bytes.buffer, key.bytes.byteOffset, key.bytes.byteLength).getUint32(0, littleEndian);
            const decoder = new TextDecoder();
            let title = "";
            for (let pos = 4; pos < length; pos += 16384) {
              const text = yield { offset: offset + 8 + pos, length: Math.min(16384, length - pos) };
              title += decoder.decode(text.bytes, { stream: true });
            }
            title += decoder.decode();
            const zero = title.indexOf("\0");
            labels.set(id, zero < 0 ? title : title.slice(0, zero));
          }
          offset += 8 + length + (length & 1);
        }
      }
    } else if (id === "fact") {
      header.factOffset = start;
      header.factSize = end - start;
    } else if (id === "data") {
      header.dataOffset = start;
      header.dataSize = end - start;
      header.declaredDataSize = size;
      if (!rf64 && !wave64 && size === 0) {
        // A zero RIFF data length means PCM continues through EOF, including later chunk headers.
        if (!Number.isFinite(byteLength)) acceptEnd((yield { offset: Infinity, length: 0 }).end);
        header.dataSize = byteLength - start;
        break;
      }
    }
    pos = end + (wave64 ? (8 - size % 8) % 8 : size & 1);
  }
  if (rf64 && (pos !== riffEnd || header.formatOffset === undefined || !header.dataOffset)) throw new Error("Invalid RF64 chunks");
  if (wave64 && (header.formatOffset === undefined || !header.dataOffset)) throw new Error("Missing Wave64 fmt or data chunk");
  for (const cue of header.cues ?? []) cue.title = labels.get(cue.id) ?? "";
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

/** Consume borrowed chunks once, retaining only metadata and the current header or label fragment.
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
  if (step.value.byteLength > size) throw new Error("Truncated Wave64 or RF64 stream");
  return step.value;
}
