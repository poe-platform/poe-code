import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { flacAst, oggAst } from "./containers/adapters.js";
import { createSyntheticMp4, parseMp4 } from "./mp4.js";

it("rejects incompatible codecs and extra audio tracks for FLAC output", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = { ...base.tracks.find(track => track.type === "audio")!,
    decodedAudio: { sampleRate: 16000, channels: 1, channelData: [Float32Array.of(0, 0.5)] } };
  assert.throws(() => flacAst().serialize({ ...base, tracks: [audio] }, { audioCodec: "pcm_s16le" }), /Exactly one FLAC audio stream/);
  for (const audioCodec of [undefined, "flac", "copy"]) {
    assert.throws(() => flacAst().serialize({ ...base, tracks: [audio, audio] }, { audioCodec }), /Exactly one FLAC audio stream/);
  }
});

it("writes FLAC audio frames and accurate STREAMINFO for decoded PCM", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = base.tracks.find(track => track.type === "audio")!;
  const samples = Float32Array.from([0, 0.5, -0.5, 0.25, -0.25]);
  const bytes = flacAst().serialize({
    ...base,
    tracks: [{ ...audio, decodedAudio: { sampleRate: 44100, channels: 1, channelData: [samples] } }]
  });
  assert.ok(bytes.length > 42, "FLAC must include audio frames");
  const firstFrame = Number(flacAst().probe(bytes, { showPackets: true }).packets![0]!.pos);
  assert.equal(bytes[firstFrame], 0xff);
  assert.equal(bytes[firstFrame + 1]! & 0xfe, 0xf8);
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
  }, { audioCodec: "flac" });
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
  }, { audioCodec: "flac" });
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  assert.throws(() => oggAst().parse(bytes), /CRC mismatch/);
});

for (const bits of [16, 24]) for (const channels of [1, 2, 8]) {
  it(`checksums interleaved ${bits}-bit PCM with ${channels} channels across frames`, () => {
    const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
    const track = base.tracks.find(track => track.type === "audio")!;
    const integers = [-(2 ** (bits - 1)), -1, 0, 1, 2 ** (bits - 1) - 1];
    const count = 4097;
    const pcm = Buffer.alloc(count * channels * bits / 8);
    const channelData = Array.from({ length: channels }, (_, channel) =>
      Float64Array.from({ length: count }, (_, i) => {
        const value = integers[(i + channel) % integers.length]!;
        pcm.writeIntLE(value, (i * channels + channel) * bits / 8, bits / 8);
        return value / 2 ** (bits - 1);
      }));
    const bytes = flacAst().serialize({ ...base, tracks: [{ ...track,
      codecDescriptions: [{ ...track.codecDescriptions[0]!, bitsPerSample: bits }],
      decodedAudio: { sampleRate: 16000, channels, channelData }
    }] });
    assert.deepEqual(bytes.subarray(26, 42), new Uint8Array(createHash("md5").update(pcm).digest()));
    assert.deepEqual(flacAst().parse(bytes).tracks[0]!.decodedAudio!.channelData, channelData);
  });
}

it("includes the sample rate in encoded FLAC frame headers for raw output", () => {
  const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
  const audio = base.tracks.find(track => track.type === "audio")!;
  for (const sampleRate of [16000, 44100, 12345, 123450]) {
    const raw = flacAst().serialize({ ...base, tracks: [{ ...audio,
      decodedAudio: { sampleRate, channels: 1, channelData: [Float32Array.of(0, 0.5)] }
    }] }, { writeHeader: false });
    assert.notEqual(raw[2]! & 15, 0, `sample rate ${sampleRate} must not depend on STREAMINFO`);
  }
});
