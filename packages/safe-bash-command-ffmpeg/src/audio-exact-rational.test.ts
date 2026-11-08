import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg swresample PCM16 impulse responses.
for (const [exactRational, center] of [
  [0, [0, -3349, 4871, 16384, 10387, -2875, 0]],
  [1, [0, -3289, 6725, 16384, 6725, -3289, 0]],
  [undefined, [0, -3289, 6725, 16384, 6725, -3289, 0]]
] as const) {
  const inputRate = 8000, rate = 12000, length = 128;
  it(`matches the ${exactRational} exact_rational PCM16 impulse response from ${inputRate} to ${rate} Hz`, async () => {
    const pcm = Buffer.alloc(length * 2);
    pcm.writeInt16LE(16384, length);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", String(inputRate), "-ac", "1", "-i", "/in.pcm",
        "-ar", String(rate), "-phase_shift", "2", "-linear_interp", "0", ...(exactRational === undefined ? [] : ["-exact_rational", String(exactRational)]), "-f", "s16le", "/out.pcm"],
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
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => output.readInt16LE((middle - 3 + i) * 2)), center);
  });
}

for (const value of ["-1", "0.5", "2", "NaN", "", undefined]) {
  it(`rejects invalid exact_rational ${String(value)} before writing output`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-exact_rational", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { assert.fail("must not write output"); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 8);
    assert.ok(stderr.includes("exact_rational must be 0 or 1"), stderr);
  });
}
