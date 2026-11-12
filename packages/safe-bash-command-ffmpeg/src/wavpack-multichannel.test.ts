import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { wavpackAst } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: -f s16le -ar 8000 -ac N -i pipe:0
// -c:a wavpack -frame_size 128. Input has 300 frames of the samples below;
// native decoding was verified byte-for-byte against that input.
for (const channels of [2, 4, 6]) {
  const input = readFileSync(new URL(`./fixtures/wavpack-${channels}ch.wv`, import.meta.url));
  const expected = Buffer.alloc(300 * channels * 2);
  for (let frame = 0; frame < 300; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      expected.writeInt16LE((frame * 131 + channel * 999) % 24000 - 10000, (frame * channels + channel) * 2);
    }
  }

  it(`decodes ${channels}-channel WavPack groups into all 300 interleaved PCM frames`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.wv", input);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wv", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(chunks);
    assert.equal(pcm.length / (channels * 2), 300);
    assert.deepEqual(pcm, expected);
  });

  it(`retains ${channels}-channel packet groups, timestamps and probe metadata`, () => {
    const doc = wavpackAst().parse(input, { decodeAudio: false, limits: { maxMemoryBytes: 0 } });
    const track = doc.tracks[0]!;
    assert.equal(doc.duration, 300);
    assert.equal(track.codecDescriptions[0]!.channels, channels);
    assert.equal(track.codecDescriptions[0]!.sampleRate, 8000);
    assert.equal(track.decodedAudio, undefined);
    assert.deepEqual(track.samples.map(sample => [sample.pts, sample.duration]), [[0, 128], [128, 128], [256, 44]]);
    assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), input.subarray(0, input.indexOf("APETAGEX")));
    const decoded = wavpackAst().parse(input).tracks[0]!.decodedAudio!;
    for (let channel = 0; channel < channels; channel++) {
      assert.equal(decoded.channelData[channel]!.length, 300);
      for (let frame = 0; frame < 300; frame++) {
        assert.equal(decoded.channelData[channel]![frame], expected.readInt16LE((frame * channels + channel) * 2) / 32768);
      }
    }
  });
}

const input = readFileSync(new URL("./fixtures/wavpack-6ch.wv", import.meta.url));
const second = input.readUInt32LE(4) + 8;
const third = second + input.readUInt32LE(second + 4) + 8;

it("rejects incomplete and inconsistent multichannel WavPack groups", () => {
  const plugin = wavpackAst();
  assert.throws(() => plugin.parse(input.subarray(0, third)), /Incomplete WavPack block group/);
  for (const [offset, value] of [[second + 16, 1], [second + 20, 127], [second + 24, input.readUInt32LE(second + 24) | 0x800]]) {
    const corrupted = Buffer.from(input);
    corrupted.writeUInt32LE(value!, offset!);
    assert.throws(() => plugin.parse(corrupted), /Inconsistent WavPack/);
  }
  assert.throws(() => plugin.parse(input.subarray(second)), /Inconsistent WavPack/);
  assert.throws(() => plugin.parse(Buffer.concat([input.subarray(0, second), input.subarray(third)])), /Inconsistent WavPack/);
});

it("accounts for all WavPack channels in the decode memory budget", () => {
  assert.throws(() => wavpackAst().parse(input, { limits: { maxMemoryBytes: 300 * 6 * 8 - 1 } }), /maxMemoryBytes/);
  assert.throws(() => wavpackAst().parse(input, { limits: { maxSamplesPerTrack: 2 } }), /maxSamplesPerTrack/);
});
