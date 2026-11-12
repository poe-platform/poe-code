import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { serializeMkv } from "./containers/mkv.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { wavpackAst } from "./containers/wavpack.js";
import { MediaBudgetTracker } from "./types.js";
import { encodeWavpackTrack } from "./wavpack-encoder.js";

for (const sampleRate of [8000, 12345]) for (const bits of [16, 24]) for (const channels of [1, 2]) {
  it(`preserves ${bits}-bit ${channels}-channel PCM at ${sampleRate} Hz across WavPack blocks and a short tail`, () => {
    const frames = 769, width = bits / 8, scale = 2 ** (bits - 1);
    const input = Buffer.alloc(frames * channels * width);
    for (let i = 256; i < frames; i++) for (let ch = 0; ch < channels; ch++) {
      const value = i % 3 === 0 ? -scale : i % 3 === 1 ? scale - 1 : ((i * 31337 + ch * 997) % (scale * 2)) - scale;
      input.writeIntLE(value, (i * channels + ch) * width, width);
    }
    const doc = rawAudioAsts().find(plugin => plugin.id === `s${bits}le`)!.parse(input, { sampleRate, channels });
    const track = encodeWavpackTrack(doc.tracks[0]!, new MediaBudgetTracker());
    assert.deepEqual(track.samples.map(sample => [sample.pts, sample.duration]), [[0, 256], [256, 256], [512, 256], [768, 1]]);
    const output = Buffer.concat(track.samples.map(sample => sample.data));
    const decoded = wavpackAst().parse(output).tracks[0]!.decodedAudio!;
    assert.equal(decoded.sampleRate, sampleRate);
    assert.deepEqual(decoded.channelData, doc.tracks[0]!.decodedAudio!.channelData);
    const native = spawnSync("ffmpeg", ["-v", "error", "-err_detect", "crccheck+explode", "-i", "pipe:0", "-f", `s${bits}le`, "pipe:1"], { input: sampleRate === 8000 ? output : serializeMkv(doc, { audioCodec: "wavpack" }) });
    assert.equal(native.status, 0, native.stderr?.toString() ?? String(native.error));
    assert.ok(native.stdout.equals(input), "Native decoding must preserve every PCM byte");
  });
}

it("enforces WavPack resource bounds before encoding or returning packets", () => {
  const doc = rawAudioAsts().find(plugin => plugin.id === "s16le")!.parse(new Uint8Array(1028), { sampleRate: 8000, channels: 2 });
  const track = doc.tracks[0]!;
  for (const limits of [{ maxMemoryBytes: 1 }, { maxOutputBytes: 1 }, { maxDurationSeconds: 0.01 }, { maxSamplesPerTrack: 1 }]) {
    assert.throws(() => encodeWavpackTrack(track, new MediaBudgetTracker(limits)), /max/);
  }
  const encoded = encodeWavpackTrack({ ...track, timescale: 1000, samples: [{ ...track.samples[0]!, pts: 125 }] }, new MediaBudgetTracker());
  assert.equal(encoded.timescale, 8000);
  assert.equal(encoded.samples[0]!.pts, 1000);
  assert.throws(() => encodeWavpackTrack({ ...track, decodedAudio: undefined }, new MediaBudgetTracker()), /decoded audio/);
  assert.throws(() => encodeWavpackTrack({ ...track, codecDescriptions: [{ ...track.codecDescriptions[0]!, bitsPerSample: 32 }] }, new MediaBudgetTracker()), /up to 24 bits/);
});
