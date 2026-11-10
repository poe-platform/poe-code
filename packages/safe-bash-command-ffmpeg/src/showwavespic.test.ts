import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const kind of ["mix", "same", "inverse"]) {
  for (const split of [false, true]) {
    for (const labeled of [false, true]) {
      for (const colored of [false, true]) {
        it(`renders native showwavespic pixels (${kind}, split=${split}, labeled=${labeled}, colored=${colored})`, async () => {
          const channels = [new Float64Array(144000), new Float64Array(144000)];
          for (let i = 0; i < 144000; i++) {
            const sample = (i % 48 < 24 ? 4096 : -4096) / 32768;
            channels[0]![i] = i < 96000 ? sample : 0;
            channels[1]![i] = kind === "mix" ? (i < 48000 ? 0 : -2 * sample)
              : kind === "same" ? sample : -sample;
          }
          const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 48000, channels })) });
          let stderr = "";
          const expression = `showwavespic=s=12x12:split_channels=${Number(split)}:colors=${colored ? "red|blue" : "white|white"}`;
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-i", "/in.wav", "-filter_complex", labeled ? `[0:a]${expression}[pic]` : expression,
              ...(labeled ? ["-map", "[pic]"] : []), "-frames:v", "1", "/out.png"],
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
          const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
          assert.equal(output.width, 12);
          assert.equal(output.height, 12);
          const expected = new Uint8Array(12 * 12 * 4);
          // Native FFmpeg draws channel magnitudes independently, even in overlay mode.
          for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
            const left = x < 8 && (split ? y === 2 : y === 5 || y === 6);
            const right = kind === "mix"
              ? x >= 4 && (split ? y === 8 || y === 9 : y >= 4 && y <= 6)
              : (split ? y === 8 : y === 5 || y === 6);
            const intensity = split ? 255 : 127;
            const value = (Number(left) + Number(right)) * intensity;
            expected.set(colored ? [Number(left) * intensity, 0, Number(right) * intensity, value]
              : [value, value, value, value], (y * 12 + x) * 4);
          }
          assert.deepEqual(output.data, expected);
        });
      }
    }
  }
}

// Decoded RGBA hashes from native FFmpeg 7.0.2, using signed 16-bit stereo PCM.
for (const [index, [scale, hash]] of ([
  ["lin", "0c1b0a28714a0e3725c4b36e0176198d12e20709b43e5aeb729215a5b110dd95"],
  ["log", "ecda00497d597f85fff606a98c3a0d8fd5acdd5a9b75f6fc29bee8470ffab30b"],
  ["sqrt", "7ed2340ded22a6482485fb6369ce1d8e81e47660b1d113892d9a8ee35ee3ebbf"],
  ["cbrt", "02776dcb38dbb77384c8d2f01dac98d47ed8de7053275c1128dd6195988350ac"]
] as const).entries()) {
  for (const option of [scale, String(index)]) {
    it(`matches native showwavespic amplitude scale ${option}`, async () => {
      const channels = [
        [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000],
        [24000, -2000, 12000, -24000]
      ].map(samples => Float64Array.from({ length: 32 }, (_, i) => samples[i % samples.length]! / 32768));
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
          `showwavespic=s=8x8:split_channels=1:scale=${option}`, "-frames:v", "1", "/out.png"],
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
      const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
      assert.equal(output.width, 8);
      assert.equal(output.height, 8);
      assert.equal(createHash("sha256").update(output.data).digest("hex"), hash);
    });
  }
}

for (const [expression, limits, error] of [
  ["showwavespic=s=0x12", {}, "invalid image size"],
  ["showwavespic=split_channels=2", {}, "invalid split_channels"],
  ["showwavespic=scale=invalid", {}, "invalid scale"],
  ["showwavespic=draw=invalid", {}, "invalid draw"],
  ["showwavespic=s=12x12", { maxPixelsPerFrame: 100 }, "maxPixelsPerFrame"],
  ["showwavespic=s=1200x1200", { maxMemoryBytes: 10000 }, "maxMemoryBytes"]
] as const) {
  it(`rejects unsupported or over-budget waveform rendering: ${expression} ${error}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(1200).fill(0.5)] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    let stderr = "";
    const result = await createFfmpegCommand({ limits }).execute({
      args: ["-y", "-i", "/in.wav", "-filter_complex", expression, "-frames:v", "1", "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes(error), stderr);
  });
}
