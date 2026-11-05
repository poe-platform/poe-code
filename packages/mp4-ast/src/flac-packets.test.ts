import assert from "node:assert/strict";
import { it } from "node:test";
import { flacAst, createSyntheticMp4, parseMp4 } from "./index.js";
import { encodeFlacPackets } from "./containers/flac.js";

it("probes actual FLAC packets through bytes, retained reads and borrowed chunks", async () => {
  const doc = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const track = doc.tracks.find(track => track.type === "audio")!;
  const parts = encodeFlacPackets({ ...doc, tracks: [{ ...track, decodedAudio: {
    sampleRate: 48000, channels: 2, channelData: [new Float32Array(4352), new Float32Array(4352)]
  } }] });
  const bytes = Uint8Array.from(parts.flatMap(part => Array.from(part)));
  const plugin = flacAst(), options = { showPackets: true, showFrames: true };
  const results = [plugin.probe(bytes, options),
    await plugin.probeMetadata!({ size: bytes.length, async read(offset, size) { return bytes.slice(offset, offset + Math.min(size, 7)); } }, options),
    await plugin.probeMetadataStream!({ async *[Symbol.asyncIterator]() {
      const borrowed = new Uint8Array(3);
      for (let offset = 0; offset < bytes.length; offset += 3) {
        const chunk = bytes.subarray(offset, offset + 3); borrowed.set(chunk); yield borrowed.subarray(0, chunk.length);
      }
      borrowed.fill(0);
    } }, options)];
  for (const result of results) {
    assert.deepEqual(Array.from(result.packets!).map(({ pts, duration, size, pos }) => ({ pts, duration, size, pos })),
      parts.slice(1).map((part, index) => ({ pts: index * 2048, duration: index === 2 ? 256 : 2048,
        size: String(part.length), pos: String(parts.slice(0, index + 1).reduce((sum, part) => sum + part.length, 0)) })));
    assert.deepEqual(Array.from(result.frames!).map(frame => frame.nb_samples), [2048, 2048, 256]);
    assert.equal(result.streams[0]!.nb_frames, undefined);
  }
});

function crc(bytes: number[], width: number, polynomial: number): number {
  let value = 0;
  for (const byte of bytes) {
    value ^= byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value & (1 << (width - 1)) ? polynomial : 0);
    value &= (1 << width) - 1;
  }
  return value;
}

it("reads variable-block sample numbers and skips frame-like metadata", async () => {
  const frames = [0, 128, 192].map((pts, index) => {
    const number = pts < 128 ? [pts] : [192 | (pts >>> 6), 128 | (pts & 63)];
    const rate = index === 0 ? [48] : index === 1 ? [187, 128] : [18, 192];
    const header = [255, 249, 0x60 | (12 + index), 8, ...number, (128 >>> index) - 1, ...rate];
    const frame = [...header, crc(header, 8, 7), 0, 0, 0]; // constant mono subframe
    const checksum = crc(frame, 16, 0x8005);
    return [...frame, checksum >>> 8, checksum & 255];
  });
  const header = new Uint8Array(42);
  header.set([102, 76, 97, 67, 0, 0, 0, 34]);
  new DataView(header.buffer).setBigUint64(18, (48000n << 44n) | (15n << 36n) | 224n);
  const bytes = Uint8Array.from([...header, 129, 0, 0, frames[0]!.length, ...frames[0]!, ...frames.flat()]);
  const result = await flacAst().probeMetadataStream!({ async *[Symbol.asyncIterator]() {
    for (const byte of bytes) yield Uint8Array.of(byte);
  } }, { showPackets: true });
  assert.deepEqual(Array.from(result.packets!).map(({ pts, duration }) => ({ pts, duration })), [
    { pts: 0, duration: 128 }, { pts: 128, duration: 64 }, { pts: 192, duration: 32 }
  ]);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  assert.equal(flacAst().probe(bytes, { showPackets: true }).packets!.length, 2);
});
