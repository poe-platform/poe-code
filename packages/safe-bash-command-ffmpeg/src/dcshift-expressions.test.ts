import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30000, -123, -2, -1, 0, 1, 2, 123, 30000, 32767, 10000];
// FFmpeg 7.0.2, signed 16-bit PCM at 8000 Hz, mono.
for (const [filter, expected] of [
  ["dcshift=1/4", [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192]],
  ["dcshift=shift=sin(PI/6)", [-16384, -13616, 16260, 16381, 16382, 16383, 16385, 16386, 16507, 32767, 32767, 26384]],
  ["dcshift=0.25", [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192]],
  ["dcshift=1", [0, 2768, 32645, 32766, 32767, 32767, 32767, 32767, 32767, 32767, 32767, 32767]],
  ["dcshift=0b1", null],
  ["dcshift=0o1", null],
  ["dcshift=shift=0b1", null],
  ["dcshift=shift=0o1", null]
] as const) for (const graph of [false, true]) {
  it(`matches native ${filter} status and destination (${graph ? "graph" : "simple"})`, async () => {
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
    if (expected === null) assert.notEqual(result.exitCode, 0, stderr);
    else assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}
