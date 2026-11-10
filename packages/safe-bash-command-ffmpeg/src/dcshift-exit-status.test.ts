import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30000, -123, -2, -1, 0, 1, 2, 123, 30000, 32767, 10000];
// Native FFmpeg 7.0.2 statuses and exact output for both filter graph forms.
for (const [shift, exitCode, expected] of [
  ["1.01", 222, null],
  ["-1.01", 222, null],
  ["foo", 234, null],
  ["shift=", 234, null],
  ["1", 0, [0, 2768, 32645, 32766, 32767, 32767, 32767, 32767, 32767, 32767, 32767, 32767]]
] as const) for (const graph of [false, true]) {
  it(`matches native dcshift=${shift} exit status and destination (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
    const output = expected === null ? Buffer.from("KEEP") : Buffer.alloc(expected.length * 2);
    expected?.forEach((sample, i) => output.writeInt16LE(sample, i * 2));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const filter = `dcshift=${shift}`;
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
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
    assert.equal(result.exitCode, exitCode, stderr);
  });
}
