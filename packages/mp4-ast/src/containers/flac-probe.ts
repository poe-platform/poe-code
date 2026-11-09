import { parseAudio, id3HeaderSize, flacFormatTags } from "@poe-code/audio-ast";
import type { Mp4Chapter } from "../types.js";

export function flacChapters(tags: Record<string, string>, duration: number): Mp4Chapter[] {
  const chapters: Mp4Chapter[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (key.length !== 10 || !key.startsWith("CHAPTER")) continue;
    const digits = key.slice(7);
    if (![...digits].every(char => char >= "0" && char <= "9")) continue;
    const parts = value.split(":");
    if (parts.length !== 3 || parts.some(part => !part.trim() || !Number.isFinite(Number(part)))) continue;
    const start = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    if (start < 0) continue;
    const title = tags[`${key}NAME`];
    chapters.push({ id: Number(digits), timescale: 1000, startTimeSeconds: start,
      endTimeSeconds: duration, title: title ?? "", tags: title === undefined ? {} : { title } });
    delete tags[key];
    delete tags[`${key}NAME`];
  }
  chapters.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  return chapters.map((chapter, index) => ({ ...chapter,
    endTimeSeconds: chapters[index + 1]?.startTimeSeconds ?? duration }));
}

/** FLAC frame boundaries require both header CRC-8 and preceding frame CRC-16. */
function checksum(value: number, byte: number, width: number, polynomial: number): number {
  value ^= byte << (width - 8);
  for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value & (1 << (width - 1)) ? polynomial : 0);
  return value & ((1 << width) - 1);
}

export function frameHeader(bytes: Uint8Array, start: number): { duration: number; number: number; variable: boolean; headerSize: number } | undefined {
  if (bytes[start] !== 255 || (bytes[start + 1]! & 254) !== 248 || (bytes[start + 3]! & 1)) return;
  const block = bytes[start + 2]! >>> 4, rate = bytes[start + 2]! & 15;
  if (!block || rate === 15 || bytes[start + 3]! >>> 4 > 10) return;
  let pos = start + 4, number = bytes[pos++]!;
  if (number >= 128) {
    let tails = 0, mask = 128;
    while (number & mask) { tails++; mask >>>= 1; }
    if (tails < 2 || tails > 7) return;
    number &= mask - 1;
    for (let i = 1; i < tails; i++) {
      const byte = bytes[pos++]!;
      if ((byte & 192) !== 128) return;
      number = number * 64 + (byte & 63);
    }
  }
  let duration = block === 1 ? 192 : block < 6 ? 576 * 2 ** (block - 2) : 256 * 2 ** (block - 8);
  if (block === 6) duration = bytes[pos++]! + 1;
  if (block === 7) { duration = bytes[pos]! * 256 + bytes[pos + 1]! + 1; pos += 2; }
  pos += rate === 12 ? 1 : rate >= 13 ? 2 : 0;
  if (pos >= bytes.length) return;
  let crc = 0;
  for (let i = start; i <= pos; i++) crc = checksum(crc, bytes[i]!, 8, 7);
  if (crc) return;
  return { duration, number, headerSize: pos + 1 - start, variable: !!(bytes[start + 1]! & 1) };
}

export class FlacFrameScanner {
  readonly header = new Uint8Array(42);
  readonly pictureBlocks: Uint8Array[] = [];
  hasReplayGain = false;
  readonly tags: Record<string, string> = {};
  private metadataBlock: Uint8Array | undefined;
  private readonly chapterTags: Record<string, string> = {};
  private readonly cueBlocks: Uint8Array[] = [];
  readonly packets: { pts: number; duration: number; size: number; pos: number }[] = [];
  size = 0;
  private pending = new Uint8Array();
  private offset = 0;
  private metadataEnd = 4;
  private prefix: number | undefined;
  private audio = false;
  private lastMetadata = false;
  private crc = 0;
  private frame: { pts: number; duration: number; pos: number } | undefined;
  private fixedBlockSize = 0;

  chapters(sampleRate: number): Mp4Chapter[] {
    const chapters: Mp4Chapter[] = [];
    for (const block of this.cueBlocks) {
      if (block.length < 400 || this.offset < this.metadataEnd) throw new Error("Truncated FLAC CUESHEET");
      const view = new DataView(block.buffer, block.byteOffset, block.length);
      let offset = 400;
      for (let index = 0; index < block[399]!; index++) {
        if (offset + 36 > block.length) throw new Error("Truncated FLAC CUESHEET track");
        const sample = Number(view.getBigUint64(offset));
        if (!Number.isSafeInteger(sample)) throw new Error("FLAC CUESHEET offset exceeds safe integer range");
        const previous = chapters.at(-1);
        if (previous) chapters[chapters.length - 1] = { ...previous, endTimeSeconds: sample / sampleRate };
        // The final track is the lead-out (170 for CD sheets), not a chapter.
        if (index + 1 < block[399]!) {
          const isrc = block.subarray(offset + 9, offset + 21);
          const title = new TextDecoder().decode(isrc.subarray(0, isrc.indexOf(0) < 0 ? 12 : isrc.indexOf(0)));
          chapters.push({ id: block[offset + 8]!, timescale: sampleRate, timeBase: { numerator: 1, denominator: sampleRate },
            startTimeSeconds: sample / sampleRate, endTimeSeconds: sample / sampleRate,
            title, tags: { title } });
        }
        offset += 36 + block[offset + 35]! * 12;
        if (offset > block.length) throw new Error("Truncated FLAC CUESHEET indices");
      }
    }
    const samples = Number(new DataView(this.header.buffer).getBigUint64(18) & 0xfffffffffn);
    return [...chapters, ...flacChapters({ ...this.chapterTags }, samples / sampleRate)];
  }

  push(chunk: Uint8Array, final = false): void {
    this.size += chunk.length;
    let bytes = chunk;
    if (this.pending.length) {
      bytes = new Uint8Array(this.pending.length + chunk.length);
      bytes.set(this.pending); bytes.set(chunk, this.pending.length);
    }
    let pos = 0;
    const end = final ? bytes.length : Math.max(0, bytes.length - 16);
    for (; pos < end; pos++, this.offset++) {
      if (this.prefix === undefined) {
        if (bytes.length - pos < 10 && !final) break;
        this.prefix = id3HeaderSize(bytes.subarray(pos));
        this.metadataEnd = this.prefix + 4;
      }
      if (this.offset < this.prefix) continue;
      if (this.offset < this.prefix + 42) this.header[this.offset - this.prefix] = bytes[pos]!;
      if (!this.audio) {
        if (this.offset < this.metadataEnd) {
          if (this.metadataBlock) this.metadataBlock[this.metadataBlock.length - (this.metadataEnd - this.offset)] = bytes[pos]!;
          if (this.metadataBlock?.[0] === 4 && this.offset + 1 === this.metadataEnd) {
            const metadata = new Uint8Array(42 + this.metadataBlock.length);
            metadata.set(this.header); metadata[4] = 0;
            metadata.set(this.metadataBlock, 42); metadata[42] = 132;
            try {
              const audio = parseAudio(metadata);
              Object.assign(this.tags, flacFormatTags(audio.nodes));
              for (const [key, value] of Object.entries(audio.tags)) {
                if (key.startsWith("CHAPTER")) this.chapterTags[key] = value;
                if (key === "REPLAYGAIN_TRACK_GAIN" || key === "REPLAYGAIN_ALBUM_GAIN") this.hasReplayGain = true;
              }
            } catch { /* Malformed comments retain the existing media-probe fallback. */ }
            this.metadataBlock = undefined;
          }
          continue;
        }
        this.metadataBlock = undefined;
        if (!this.lastMetadata) {
          if (pos + 4 > bytes.length) break;
          this.lastMetadata = !!(bytes[pos]! & 128);
          this.metadataEnd = this.offset + 4 + bytes[pos + 1]! * 65536 + bytes[pos + 2]! * 256 + bytes[pos + 3]!;
          const type = bytes[pos]! & 127;
          if (type === 6 || type === 5 || type === 4) {
            this.metadataBlock = new Uint8Array(this.metadataEnd - this.offset);
            this.metadataBlock[0] = type;
            if (type !== 4) (type === 6 ? this.pictureBlocks : this.cueBlocks).push(this.metadataBlock);
          }
          continue;
        }
        this.audio = true;
      }
      if (!this.frame || this.crc === 0) {
        const header = frameHeader(bytes, pos);
        if (header) {
          if (this.frame) this.packets.push({ ...this.frame, size: this.offset - this.frame.pos });
          this.fixedBlockSize ||= header.duration;
          this.frame = { pts: header.variable ? header.number : header.number * this.fixedBlockSize,
            duration: header.duration, pos: this.offset };
          this.crc = 0;
        }
      }
      if (this.frame) this.crc = checksum(this.crc, bytes[pos]!, 16, 0x8005);
    }
    this.pending = bytes.slice(pos);
    if (final && this.frame && this.crc === 0) {
      this.packets.push({ ...this.frame, size: this.offset - this.frame.pos });
      this.frame = undefined;
    }
  }
}
