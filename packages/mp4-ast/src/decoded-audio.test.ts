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
