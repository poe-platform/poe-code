import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg swresample PCM16 impulse responses.
for (const [inputRate, rate, length, center, tail, filterSize] of [
  [16000, 8000, 256, [211, -229, 242, 7946, 242, -229, 211],
    [7946, 242, -229, 211, -186, 159, -130, 103, -77, 55, -38, 24, -14, 8, -4, 1]],
  [8000, 16000, 128, [-3349, 0, 10387, 16384, 10387, 0, -3349],
    [16384, 10387, 0, -3349, 0, 1880, 0, -1213, 0, 823, 0, -566, 0, 387, 0, -259,
      0, 169, 0, -106, 0, 63, 0, -35, 0, 18, 0, -8, 0, 3, 0, -1]],
  [8000, 8000, 128, [0, 0, 0, 16384, 0, 0, 0], [16384]],
  [8000, 16000, 128, [-205, 0, 7969, 16384, 7969, 0, -205], [16384, 7969, 0, -205], 4],
  [8000, 16000, 128, [-205, 0, 7969, 16384, 7969, 0, -205], [16384, 7969, 0, -205], 3],
  [8000, 16000, 128, [0, 0, 3365, 16384, 3365, 0, 0], [16384, 3365], 2],
  [8000, 16000, 128, [0, 0, 0, 16384, 10, 0, 0], [16384, 10], 0],
  [8000, 16000, 128, [0, 0, 0, 16384, 10, 0, 0], [16384, 10], 1],
  [8000, 4000, 128, [0, -9, 122, 7981, 122, -9, 0], [7981, 122, -9], 4],
  [8000, 16000, 128, [-1875, 0, 9759, 16384, 9759, 0, -1875], [16384, 9759, 0, -1875, 0, 329, 0, -21], 8],
  [8000, 8000, 128, [0, 0, 0, 16384, 0, 0, 0], [16384], 4]
] as const) {
  it(`matches the ${filterSize ?? "default"} PCM16 impulse response from ${inputRate} to ${rate} Hz`, async () => {
    const pcm = Buffer.alloc(length * 2);
    pcm.writeInt16LE(16384, length);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", String(inputRate), "-ac", "1", "-i", "/in.pcm",
        "-ar", String(rate), ...(filterSize === undefined ? [] : ["-filter_size", String(filterSize)]), "-f", "s16le", "/out.pcm"],
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
    assert.equal(output.length / 2, length * rate / inputRate);
    const middle = output.length / 4;
    for (let i = 0; i < output.length / 2; i++) {
      const expected = filterSize !== undefined && filterSize <= 1 && i < middle ? 0 : tail[Math.abs(i - middle)] ?? 0;
      // Native PCM16 coefficient quantization can differ by one least-significant bit.
      assert.ok(Math.abs(output.readInt16LE(i * 2) - expected) <= 1, `sample ${i}`);
    }
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => output.readInt16LE((middle - 3 + i) * 2)), center);
  });
}

for (const value of ["-1", "1.5", "2147483648", "NaN", "", undefined]) {
  it(`rejects invalid filter_size ${String(value)} before writing output`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-filter_size", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { assert.fail("must not write output"); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 8);
    assert.ok(stderr.includes("filter_size must be an integer"), stderr);
  });
}
