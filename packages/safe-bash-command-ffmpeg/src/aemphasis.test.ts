import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 impulse of 1001 followed by seven zeros.
for (const [sampleRate, filter, expected] of [
  [8000, "anull", [1001, 0, 0, 0, 0, 0, 0, 0]],
  [8000, "aemphasis", [578, 545, -94, 26, -7, -4, 10, -13]],
  [8000, "aemphasis=type=riaa", [432, 786, 420, 299, 341, 282, 306, 269]],
  [8000, "aemphasis=1:1:reproduction:cd", [578, 545, -94, 26, -7, -4, 10, -13]],
  [8000, "aemphasis=type=riaa:", [432, 786, 420, 299, 341, 282, 306, 269]],
  [8000, "aemphasis=level_in=0.5:level_out=0.5:type=cd", [144, 136, -23, 7, -2, -1, 2, -3]],
  [8000, "aemphasis,volume=0.5", [289, 273, -47, 13, -3, -2, 5, -6]],
  [44100, "aemphasis", [356, 337, 70, 144, 27, 53, 18, 12]],
  [44100, "aemphasis=type=riaa", [108, 241, 206, 158, 141, 114, 105, 90]],
  [48000, "aemphasis", [330, 343, 67, 140, 43, 44, 34, 6]],
  [48000, "aemphasis=type=riaa", [94, 222, 198, 151, 138, 111, 102, 89]]
] as const) {
  for (const complex of [false, true]) {
    for (const channelCount of [1, 2]) {
      it(`matches native ${filter} PCM samples (${sampleRate} Hz, ${channelCount} channels, ${complex ? "graph" : "simple"})`, async () => {
        const volume = new Volume();
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate,
          channels: [[1001, 0, 0, 0, 0, 0, 0, 0], [0, 0, -1001, 0, 0, 0, 0, 0]]
            .slice(0, channelCount).map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(complex
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
          expected.flatMap((sample, i) => channelCount === 1 ? [sample] : [sample, i < 2 ? 0 : 0 - expected[i - 2]!]));
      });
    }
  }
}

for (const [filter, expectedHash] of [
  ["aemphasis", "f1f7e2ae983eaf987985d5d216c45b3b8a6f379a9eb4c952e043ab57e68ca70f"],
  ["aemphasis=type=riaa", "4cb7445d5977ca66413eb4614374279e409b5893e12feea3b49506c0986f4bba"]
] as const) {
  it(`preserves ${filter} history across input frames`, async () => {
    const input = Buffer.alloc(10000);
    for (let i = 0; i < 5000; i++) input.writeInt16LE((i * 7919) % 20001 - 10000, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "1", "-i", "/in.raw",
        "-af", filter, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw");
    assert.equal(output.length, input.length);
    // Hash of every output byte from native FFmpeg 7.0.2 with the same input.
    assert.equal(createHash("sha256").update(output).digest("hex"), expectedHash);
  });
}

for (const [argument, exitCode] of [
  ["level_in=-1", 222], ["level_out=65", 222], ["level_in=invalid", 234],
  ["unknown=1", 8], ["type=invalid", 234],
  ["mode=production", 8], ["type=50fm", 8]
] as const) {
  it(`rejects aemphasis=${argument} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(16), "/out.raw": "existing" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `aemphasis=${argument}`, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.match(stderr, /aemphasis:/);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "existing");
  });
}
