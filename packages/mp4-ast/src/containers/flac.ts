import type { MediaDocument } from "../types.js";

function crc(bytes: Uint8Array, width: number, polynomial: number): number {
  let value = 0;
  const mask = (1 << width) - 1;
  for (const byte of bytes) {
    value ^= byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) {
      value = ((value << 1) ^ ((value & (1 << (width - 1))) ? polynomial : 0)) & mask;
    }
  }
  return value;
}

function frameNumber(value: number): number[] {
  if (value < 128) return [value];
  const tail: number[] = [];
  while (value >= (1 << (6 - tail.length))) {
    tail.unshift(0x80 | (value & 63));
    value = Math.floor(value / 64);
  }
  return [(0xff << (7 - tail.length)) & 255 | value, ...tail];
}

/** Encode 16-bit PCM using FLAC's lossless verbatim subframes. */
export function encodeFlacPackets(doc: MediaDocument): Uint8Array[] {
  const track = doc.tracks.find(track => track.type === "audio");
  const audio = track?.decodedAudio;
  if (!audio) {
    const data = track?.samples[0]?.data;
    if (data && data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) return [data.slice()];
    throw new Error("FLAC encoding requires decoded PCM audio");
  }
  const { sampleRate, channels, channelData } = audio;
  const count = channelData[0]?.length ?? 0;
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 655350 ||
      !Number.isInteger(channels) || channels < 1 || channels > 8 ||
      channelData.length !== channels || channelData.some(data => data.length !== count) || count === 0) {
    throw new Error("Invalid FLAC PCM dimensions");
  }
  const blockSize = 2048;
  const header = new Uint8Array(42);
  header.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  const view = new DataView(header.buffer);
  view.setUint16(8, blockSize);
  view.setUint16(10, blockSize);
  view.setBigUint64(18, BigInt(sampleRate) << 44n | BigInt(channels - 1) << 41n | 15n << 36n | BigInt(count));
  // An all-zero MD5 means the checksum is unavailable (RFC 9639).
  const frames: Uint8Array[] = [header];
  for (let offset = 0, index = 0; offset < count; offset += blockSize, index++) {
    const length = Math.min(blockSize, count - offset);
    const prefix = Uint8Array.from([0xff, 0xf8, 0x70, ((channels - 1) << 4) | 8,
      ...frameNumber(index), (length - 1) >>> 8, (length - 1) & 255]);
    const frame = new Uint8Array(prefix.length + 1 + channels * (1 + length * 2) + 2);
    frame.set(prefix);
    frame[prefix.length] = crc(prefix, 8, 0x07);
    const frameView = new DataView(frame.buffer);
    let pos = prefix.length + 1;
    for (const data of channelData) {
      frame[pos++] = 2; // VERBATIM, no wasted bits
      for (let i = offset; i < offset + length; i++) {
        const value = data[i]!;
        if (!Number.isFinite(value)) throw new Error("FLAC PCM sample must be finite");
        frameView.setInt16(pos, Math.max(-32768, Math.min(32767, Math.round(value * 32768))));
        pos += 2;
      }
    }
    frameView.setUint16(pos, crc(frame.subarray(0, pos), 16, 0x8005));
    frames.push(frame);
  }
  return frames;
}
