import { BitReader } from './binary.js';
import type { Mp4SampleSteps, Mp4TableRange } from './mp4-sample-source.js';
import type { MediaCodecDescription } from './types.js';

/** Read picture timing without retaining NAL payloads or decoding video. */
export function* h264FieldOrderSteps(table: Mp4TableRange, timing: NonNullable<MediaCodecDescription['h264PictureTiming']>): Mp4SampleSteps<MediaCodecDescription['fieldOrder']> {
  const end = table.payloadOffset + table.payloadSize;
  let offset = table.payloadOffset;
  while (end - offset > timing.nalLengthSize) {
    const prefix = (yield { kind: 'read', table, offset, length: timing.nalLengthSize + 1 }) as Uint8Array;
    let length = 0;
    for (let i = 0; i < timing.nalLengthSize; i++) length = length * 256 + prefix[i]!;
    offset += timing.nalLengthSize;
    if (!length || length > end - offset) return;
    const nalEnd = offset + length, type = prefix[timing.nalLengthSize]! & 31;
    if (type === 1 || type === 5) return; // Timing precedes the first picture.
    offset++;
    if (type === 6) {
      let zeros = 0;
      function* byte(): Mp4SampleSteps<number> {
        while (offset < nalEnd) {
          const value = ((yield { kind: 'read', table, offset: offset++, length: 1 }) as Uint8Array)[0]!;
          if (zeros === 2 && value === 3) { zeros = 0; continue; }
          zeros = value === 0 ? zeros + 1 : 0;
          return value;
        }
        return -1;
      }
      while (offset < nalEnd) {
        let payloadType = 0, payloadSize = 0, value: number;
        do { value = yield* byte(); if (value < 0) return; payloadType += value; } while (value === 255);
        if (payloadType === 128 && offset === nalEnd) break; // rbsp_trailing_bits
        do { value = yield* byte(); if (value < 0) return; payloadSize += value; } while (value === 255);
        if (payloadSize > nalEnd - offset) return;
        if (payloadType === 1) {
          const needed = Math.ceil((timing.delayBits + 4) / 8);
          if (payloadSize < needed) return;
          const bytes = new Uint8Array(needed);
          for (let i = 0; i < needed; i++) { value = yield* byte(); if (value < 0) return; bytes[i] = value; }
          const bits = new BitReader(bytes, timing.delayBits), structure = bits.readBits(4);
          if ([0, 7, 8].includes(structure)) return 'progressive';
          if ([1, 3, 5].includes(structure)) return 'tt';
          if ([2, 4, 6].includes(structure)) return 'bb';
          return;
        }
        for (let i = 0; i < payloadSize; i++) if ((yield* byte()) < 0) return;
      }
    }
    offset = nalEnd;
  }
}
