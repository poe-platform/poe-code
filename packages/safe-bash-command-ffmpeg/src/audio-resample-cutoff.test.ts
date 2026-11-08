import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 impulse responses, including codec/resampler option routing.
for (const [options, center] of [
  [["-resample_cutoff", "0.5"], [-837, 0, 2597, 4096, 2597, 0, -837]],
  [["-resample_cutoff", "0.9"], [625, -727, 795, 7373, 795, -727, 625]],
  [["-resample_cutoff", "0"], [211, -229, 242, 7946, 242, -229, 211]],
  [["-resample_cutoff", "1"], [0, 0, 0, 8192, 0, 0, 0]],
  [["-cutoff", "0.5"], [211, -229, 242, 7946, 242, -229, 211]],
  [["-resample_cutoff", "0.5", "-cutoff", "0.9"], [-837, 0, 2597, 4096, 2597, 0, -837]]
] as const) {
  it(`matches native downsampling with ${options.join(" ")}`, async () => {
    const pcm = Buffer.alloc(512);
    pcm.writeInt16LE(16384, 256);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "/in.pcm",
        "-ar", "8000", ...options, "-f", "s16le", "/out.pcm"],
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
    assert.equal(output.length, 256);
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => output.readInt16LE((61 + i) * 2)), center);
  });
}

for (const value of ["-0.1", "1.1", "NaN", "Infinity", "", undefined]) {
  it(`rejects invalid resample_cutoff ${String(value)} before writing output`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-resample_cutoff", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { assert.fail("must not write output"); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 8);
    assert.ok(stderr.includes("resample_cutoff must be a number between 0 and 1"), stderr);
  });
}
