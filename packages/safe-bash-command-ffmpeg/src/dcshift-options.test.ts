import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30000, -123, -2, -1, 0, 1, 2, 123, 30000, 32767, 10000];
// Native FFmpeg 7.0.2, s16le mono at 8000 Hz, for both filter graph forms.
for (const [filter, expected] of [
  ["dcshift=shift=0.125:shift=0.25", [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192]],
  ["dcshift=0.125:shift=0.25", [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192]],
  ["dcshift=shift=0.25:shift=0.125", [-28672, -25904, 3973, 4094, 4095, 4096, 4097, 4098, 4219, 32767, 32767, 14096]],
  ["dcshift=0.25", [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192]],
  ["dcshift=0.125", [-28672, -25904, 3973, 4094, 4095, 4096, 4097, 4098, 4219, 32767, 32767, 14096]],
  ["dcshift=0.25:shift=2", null],
  ["dcshift=0.25:shift=", null]
] as const) for (const graph of [false, true]) {
  it(`honors dcshift assignments for ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
    const output = expected === null ? Buffer.from("KEEP") : Buffer.alloc(expected.length * 2);
    expected?.forEach((sample, i) => output.writeInt16LE(sample, i * 2));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expected === null ? 1 : 0, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}
