import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-30000, -12345, -401, -1, 0, 1, 401, 12345, 30000];
// Native FFmpeg 7.0.2, signed 16-bit PCM at 8000 Hz, mono.
for (const [expression, expected, exitCode] of [
  ["25+25", [-32315, -19527, -798, -2, 0, 2, 798, 19527, 32315], 0],
  ["100/2", [-32315, -19527, -798, -2, 0, 2, 798, 19527, 32315], 0],
  ["PI*10", [-32381, -19068, -735, -2, 0, 2, 735, 19068, 32381], 0],
  ["50", [-32315, -19527, -798, -2, 0, 2, 798, 19527, 32315], 0],
  ["2", [-32474, -18330, -637, -2, 0, 2, 637, 18330, 32474], 0],
  ["8", [-32456, -18482, -657, -2, 0, 2, 657, 18482, 32456], 0],
  ["50+E-E+PHI-PHI", [-32315, -19527, -798, -2, 0, 2, 798, 19527, 32315], 0],
  ["0b10", null, 234],
  ["0o10", null, 234],
  ["25+", null, 234],
  ["101/1", null, 222],
  ["0-1", null, 222]
] as const) for (const named of [false, true]) for (const graph of [false, true]) {
  const filter = `acontrast=${named ? "contrast=" : ""}${expression}`;
  it(`matches native ${filter} status and output (${graph ? "graph" : "simple"})`, async () => {
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
    assert.equal(result.exitCode, exitCode, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}
