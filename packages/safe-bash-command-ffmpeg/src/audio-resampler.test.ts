import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const soxrImpulse = [
  -1, 2, -2, 2, -3, 3, -4, 4, -5, 5, -5, 5, -5, 5, -4, 3,
  -2, 1, 1, -3, 5, -7, 10, -13, 16, -20, 23, -26, 29, -32, 35, -37,
  38, -38, 38, -36, 33, -29, 24, -17, 8, 2, -14, 27, -42, 58, -75, 94,
  -114, 134, -155, 176, -197, 218, -238, 258, -276, 293, -308, 322, -333, 342, -348, 352,
  7839, 352, -348, 342, -333, 322, -308, 293, -276, 258, -238, 218, -197, 176, -155, 134,
  -114, 94, -75, 58, -42, 27, -14, 2, 8, -17, 24, -29, 33, -36, 38, -38,
  38, -37, 35, -32, 29, -26, 23, -20, 16, -13, 10, -7, 5, -3, 1, 1,
  -2, 3, -4, 5, -5, 5, -5, 5, -5, 4, -4, 3, -3, 2, -2, 2,
];

// Native FFmpeg / SoXR 20-bit HQ PCM16 impulse responses.
for (const [engine, inputRate, rate, length, impulse, start, expected, options] of [
  ["swr", 16000, 8000, 256, 128, 61, [211, -229, 242, 7946, 242, -229, 211]],
  ["0", 16000, 8000, 256, 128, 61, [211, -229, 242, 7946, 242, -229, 211]],
  ["soxr", 16000, 8000, 256, 128, 0, soxrImpulse],
  ["1", 16000, 8000, 256, 128, 0, soxrImpulse],
  ["soxr", 8000, 16000, 256, 128, 253, [-3400, 704, 10405, 15677, 10405, 704, -3400]],
  ["soxr", 16000, 8000, 8, 0, 0, [7839, 352, -348, 342]],
  ["soxr", 8000, 16000, 3, 0, 0, [15677, 10405, 704, -3400, -696, 1959]],
  ["soxr", 8000, 8000, 8, 0, 0, [16384, 0, 0, 0, 0, 0, 0]],
  ["soxr", 16000, 8000, 256, 128, 0, soxrImpulse,
    ["-filter_size", "0", "-kaiser_beta", "2", "-phase_shift", "0", "-linear_interp", "0", "-exact_rational", "0"]],
  ["soxr", 16000, 8000, 256, 128, 61, [681, -756, 803, 7373, 803, -756, 681], ["-resample_cutoff", "0.5"]],
  ["soxr", 16000, 8000, 256, 128, 61, [20, -20, 20, 8172, 20, -20, 20], ["-resample_cutoff", "1"]]
] as const) for (const channels of [1, 2]) {
  it(`matches ${engine} from ${inputRate} to ${rate} Hz with ${length} samples and ${channels} channels ${options?.join(" ") ?? ""}`, async () => {
    const pcm = Buffer.alloc(length * channels * 2);
    for (let c = 0; c < channels; c++) pcm.writeInt16LE(c ? -16384 : 16384, (impulse * channels + c) * 2);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", String(inputRate), "-ac", String(channels), "-i", "/in.pcm",
        "-ar", String(rate), "-resampler", engine, ...options ?? [], "-f", "s16le", "/out.pcm"],
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
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length / (2 * channels), Math.round(length * rate / inputRate));
    for (let i = 0; i < expected.length; i++) for (let c = 0; c < channels; c++) {
      // SoXR's PCM16 dithering can change the least-significant bit.
      const actual = output.readInt16LE(((start + i) * channels + c) * 2);
      const value = expected[i]! * (c ? -1 : 1);
      assert.ok(Math.abs(actual - value) <= 1, `sample ${start + i}, channel ${c}: ${actual} vs ${value}`);
    }
  });
}

for (const value of ["2", "-1", "unknown", "", undefined]) {
  it(`rejects invalid resampler ${String(value)} before writing output`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-resampler", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { assert.fail("must not write output"); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 8);
    assert.ok(stderr.includes("resampler must be swr or soxr"), stderr);
  });
}
