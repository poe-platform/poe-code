import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { parseMp4, serializeMp4 } from "./mp4.js";

for (const channels of [1, 2]) for (const frames of [17, 4096, 8200]) {
  it(`encodes ${frames} PCM frames as ${channels}-channel ALAC with a lossless native round trip`, () => {
    const input = Buffer.alloc(frames * channels * 2);
    for (let i = 0; i < frames * channels; i++) input.writeInt16LE((i * 331) % 65536 - 32768, i * 2);
    const doc = rawAudioAsts().find(plugin => plugin.id === "s16le")!.parse(input, { sampleRate: 8000, channels });
    const output = serializeMp4(doc, { format: "mov", audioCodec: "alac" });
    const parsed = parseMp4(output, { decodeAudio: false });
    assert.equal(parsed.tracks[0]!.codecDescriptions[0]!.codecName, "alac");
    const decode = (bytes: Uint8Array) => {
      const result = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input: bytes });
      assert.equal(result.status, 0, result.stderr.toString());
      assert.deepEqual(result.stdout, input);
    };
    decode(output);
    decode(serializeMp4(parsed, { format: "mov", audioCodec: "copy" }));
  });
}

it("preserves 24-bit PCM and enforces encoding memory limits", () => {
  const input = Buffer.alloc(5000 * 3);
  for (let i = 0; i < 5000; i++) input.writeIntLE((i * 19937) % 16777216 - 8388608, i * 3, 3);
  const doc = rawAudioAsts().find(plugin => plugin.id === "s24le")!.parse(input, { sampleRate: 48000, channels: 1 });
  assert.throws(() => serializeMp4(doc, { audioCodec: "alac", limits: { maxMemoryBytes: 1 } }), /maxMemoryBytes/);
  const output = serializeMp4(doc, { format: "mp4", audioCodec: "alac" });
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"], { input: output });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, input);
});

it("keeps full ALAC packets within the configuration's maximum frame size", () => {
  const doc = rawAudioAsts().find(plugin => plugin.id === "s16le")!.parse(new Uint8Array(4097 * 4), { sampleRate: 8000, channels: 2 });
  const parsed = parseMp4(serializeMp4(doc, { format: "mov", audioCodec: "alac" }), { decodeAudio: false });
  const track = parsed.tracks[0]!;
  const extra = track.codecDescriptions[0]!.extraData!;
  const maximum = new DataView(extra.buffer, extra.byteOffset, extra.byteLength).getUint32(24);
  assert.equal(maximum, 16388);
  assert.deepEqual(track.samples.map(sample => [sample.duration, sample.data.length]), [[4096, maximum], [1, 12]]);
});
