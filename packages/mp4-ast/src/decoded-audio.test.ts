import { readWavHeader } from "./containers/wav-header.js";
import assert from "node:assert/strict";
import { it } from "node:test";
import { concatMp4, sliceMp4, muxMp4, parseWav, serializeWav, type MediaDocument } from "./index.js";

function audio(sampleRate = 4, channelData = [Float32Array.from([0, .25, .5, .75, 0, -.25, -.5, -.75])]): MediaDocument {
  const duration = channelData[0]!.length;
  return {
    containerFormat: "wav", timescale: sampleRate, duration, durationSeconds: duration / sampleRate, metadata: {},
    tracks: [{
      id: 1, type: "audio", handlerType: "soun", language: "und", enabled: true,
      timescale: sampleRate, duration, samples: [],
      codecDescriptions: [{ formatFourCC: "sowt", codecName: "pcm_s16le", sampleRate, channels: channelData.length }],
      decodedAudio: { sampleRate, channels: channelData.length, channelData }
    }]
  };
}

it("rejects WAV serialization without decoded or PCM source audio", () => {
  const source = audio();
  assert.throws(() => serializeWav({ ...source, tracks: [] }), /WAV encoding requires decoded PCM audio/);
  const encoded = { ...source.tracks[0]!, decodedAudio: undefined,
    codecDescriptions: [{ formatFourCC: "mp4a", codecName: "aac", sampleRate: 4, channels: 1 }] };
  assert.throws(() => serializeWav({ ...source, tracks: [encoded] }), /WAV encoding requires decoded PCM audio/);
});

it("slices decoded waveforms at rounded sample boundaries without mutating the input", () => {
  const source = parseWav(serializeWav(audio()));
  const result = sliceMp4(source, { startSeconds: .375, durationSeconds: .75 });
  assert.deepEqual(result.tracks[0]!.decodedAudio!.channelData[0], source.tracks[0]!.decodedAudio!.channelData[0]!.slice(2, 5));
  assert.equal(result.durationSeconds, .75);
  assert.equal(parseWav(serializeWav(result)).durationSeconds, .75);
  assert.equal(source.tracks[0]!.decodedAudio!.channelData[0]!.length, 8);
  assert.equal(sliceMp4(source, { startSeconds: 3 }).durationSeconds, 0);
  assert.equal(sliceMp4(source, { startSeconds: 1, endSeconds: 1 }).durationSeconds, 0);
});

it("concatenates every decoded segment and preserves exact timing for decoded-only tracks", () => {
  const source = audio();
  const result = concatMp4([source, source, source]);
  assert.equal(result.durationSeconds, 6);
  assert.deepEqual(Array.from(result.tracks[0]!.decodedAudio!.channelData[0]!), Array.from({ length: 3 }, () => Array.from(source.tracks[0]!.decodedAudio!.channelData[0]!)).flat());
  assert.equal(parseWav(serializeWav(result)).durationSeconds, 6);
});

it("resamples and duplicates mono channels to match the first stereo segment", () => {
  const result = concatMp4([audio(4, [new Float32Array(4), new Float32Array(4)]), audio(2, [Float32Array.from([0, 1])])]);
  assert.equal(result.durationSeconds, 2);
  for (const channel of result.tracks[0]!.decodedAudio!.channelData) {
    assert.deepEqual(Array.from(channel), [0, 0, 0, 0, 0, .5, 1, 1]);
  }
});

it("downmixes stereo to mono and trims decoded audio for shortest muxing", () => {
  const result = concatMp4([audio(2, [new Float32Array(2)]), audio(2, [Float32Array.from([1, 0]), Float32Array.from([0, 1])])]);
  assert.deepEqual(Array.from(result.tracks[0]!.decodedAudio!.channelData[0]!), [0, 0, .5, .5]);
  const muxed = muxMp4([audio(), audio(4, [new Float32Array(4)])], { shortest: true });
  assert.equal(muxed.durationSeconds, 1);
  assert.equal(muxed.tracks[0]!.decodedAudio!.channelData[0]!.length, 4);
});

it("preserves trimmed timing through concatenation and fills alignment gaps with silence", () => {
  const trimmed = sliceMp4(audio(), { startSeconds: .5, durationSeconds: .75 });
  assert.equal(concatMp4([trimmed, trimmed]).durationSeconds, 1.5);
  const short = audio(4, [Float32Array.from([1, 1, 1, 1])]);
  const long = audio(4, [new Float32Array(8)]);
  const combined = { ...short, tracks: [...short.tracks, ...long.tracks] };
  const aligned = concatMp4([combined, short]);
  assert.deepEqual(Array.from(aligned.tracks[0]!.decodedAudio!.channelData[0]!), [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]);
  const unaligned = concatMp4([combined, short], { alignTrackDurations: false });
  assert.equal(unaligned.tracks[0]!.decodedAudio!.channelData[0]!.length, 8);
});

it("accounts for decoded concat memory and rejects partially decoded tracks", () => {
  assert.throws(() => concatMp4([audio(), audio()], { limits: { maxMemoryBytes: 1 } }), /maxMemoryBytes/);
  const encoded = parseWav(serializeWav(audio()));
  assert.throws(() => concatMp4([audio(), { ...encoded, tracks: encoded.tracks.map((track) => ({ ...track, decodedAudio: undefined })) }]), /all segments/);
});

it("copies WAV PCM packets without passing through lossy decoded samples", () => {
  const input = parseWav(serializeWav(audio()));
  input.tracks[0]!.decodedAudio!.channelData[0]!.fill(0);
  const output = parseWav(serializeWav(input, { audioCodec: "copy" }));
  assert.deepEqual(output.tracks[0]!.samples, input.tracks[0]!.samples);
});

for (const [codec, bits, tag] of [
  ["pcm_u8", 8, 1], ["pcm_s16le", 16, 1], ["pcm_s24le", 24, 1],
  ["pcm_s32le", 32, 1], ["pcm_f32le", 32, 3]
] as const) {
  it(`writes ${codec} WAV headers and interleaved samples and preserves them on copy`, () => {
    const source = audio(48000, [Float32Array.from([-1, 0, .5]), Float32Array.from([.25, -.5, 1])]);
    const bytes = serializeWav(source, { audioCodec: codec });
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const extended = tag === 1 && bits > 16;
    const { dataOffset } = readWavHeader(bytes);
    assert.equal(header.getUint16(20, true), extended ? 0xfffe : tag);
    assert.equal(header.getUint16(34, true), bits);
    assert.equal(header.getUint16(32, true), 2 * bits / 8);
    assert.equal(header.getUint32(28, true), 48000 * 2 * bits / 8);
    assert.equal(header.getUint32(dataOffset - 4, true), 6 * bits / 8);
    const output = parseWav(bytes);
    assert.equal(output.tracks[0]!.codecDescriptions[0]!.codecName, codec);
    const payload = bytes.subarray(dataOffset);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const samples = Array.from({ length: 6 }, (_, i) => {
      const offset = i * bits / 8;
      if (tag === 3) return view.getFloat32(offset, true);
      if (bits === 8) return view.getUint8(offset) - 128;
      if (bits === 16) return view.getInt16(offset, true);
      if (bits === 24) return (payload[offset]! | payload[offset + 1]! << 8 | payload[offset + 2]! << 16) << 8 >> 8;
      return view.getInt32(offset, true);
    });
    const scale = 2 ** (bits - 1);
    assert.deepEqual(samples, tag === 3 ? [-1, .25, 0, -.5, .5, 1] : [-scale, scale / 4, 0, -scale / 2, scale / 2, scale - 1]);
    output.tracks[0]!.decodedAudio!.channelData.forEach(channel => channel.fill(0));
    assert.deepEqual(serializeWav(output, { audioCodec: "copy" }), bytes);
  });
}

it("preserves floating WAV values outside the integer PCM range", () => {
  const source = audio(4, [Float32Array.from([-2, 1.5])]);
  const result = parseWav(serializeWav(source, { audioCodec: "pcm_f32le" }));
  assert.deepEqual(result.tracks[0]!.decodedAudio!.channelData, source.tracks[0]!.decodedAudio!.channelData);
});

it("matches native FFmpeg PCM24 quantization through signed 32-bit samples", () => {
  const source = audio(48000, [Float32Array.from([-1.5, -.5, .5, 1.5], value => value / 8388608)]);
  const output = parseWav(serializeWav(source, { audioCodec: "pcm_s24le" }));
  assert.deepEqual(Array.from(output.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 8388608), [-2, -1, 0, 1]);
});
