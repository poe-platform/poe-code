import assert from "node:assert/strict";
import { it } from "node:test";
import { flacAst, oggAst } from "./containers/adapters.js";
import { createSyntheticMp4, parseMp4 } from "./mp4.js";

it("writes FLAC audio frames and accurate STREAMINFO for decoded PCM", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = base.tracks.find(track => track.type === "audio")!;
  const samples = Float32Array.from([0, 0.5, -0.5, 0.25, -0.25]);
  const bytes = flacAst().serialize({
    ...base,
    tracks: [{ ...audio, decodedAudio: { sampleRate: 44100, channels: 1, channelData: [samples] } }]
  });
  assert.ok(bytes.length > 42, "FLAC must include audio frames");
  assert.equal(bytes[42], 0xff);
  assert.equal(bytes[43]! & 0xfe, 0xf8);
  const packed = new DataView(bytes.buffer, bytes.byteOffset + 18, 8).getBigUint64(0);
  assert.equal(Number(packed >> 44n), 44100);
  assert.equal(Number((packed >> 41n) & 7n) + 1, 1);
  assert.equal(Number(packed & 0xfffffffffn), samples.length);
});


it("writes playable Ogg FLAC with separate header and audio pages", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = base.tracks.find(track => track.type === "audio")!;
  const bytes = oggAst().serialize({
    ...base,
    tracks: [{ ...audio, decodedAudio: { sampleRate: 44100, channels: 1, channelData: [new Float32Array(4410)] } }]
  });
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "OggS");
  assert.equal(bytes[5], 2);
  assert.notEqual(new DataView(bytes.buffer, bytes.byteOffset).getUint32(22, true), 0);
  assert.ok(bytes.length > 100);
  const parsed = oggAst().parse(bytes);
  assert.equal(parsed.durationSeconds, 0.1);
  assert.equal(parsed.tracks[0]!.codecDescriptions[0]!.codecName, "flac");
  assert.equal(parsed.tracks[0]!.codecDescriptions[0]!.channels, 1);
});

it("rejects invalid PCM instead of emitting corrupt FLAC", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = base.tracks.find(track => track.type === "audio")!;
  assert.throws(() => flacAst().serialize({
    ...base, tracks: [{ ...audio, decodedAudio: { sampleRate: 44100, channels: 1, channelData: [Float32Array.of(Number.NaN)] } }]
  }), /finite/);
  assert.throws(() => flacAst().serialize({ ...base, tracks: [audio] }), /decoded PCM/);
});

it("rejects corrupted Ogg audio page checksums", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = base.tracks.find(track => track.type === "audio")!;
  const bytes = oggAst().serialize({
    ...base, tracks: [{ ...audio, decodedAudio: { sampleRate: 44100, channels: 1, channelData: [new Float32Array(4097)] } }]
  });
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  assert.throws(() => oggAst().parse(bytes), /CRC mismatch/);
});
