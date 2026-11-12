import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 statuses and complete interleaved PCM16 output.
const samples = [101, -901, 202, -802, 303, -703, 404, -604];
for (const [layout, filter, status, expected] of [
  ["FL+FC", "aformat=channel_layouts=mono", 234, []],
  ["BL+BR", "aresample=ochl=stereo", 234, []],
  ["stereo", "aformat=channel_layouts=mono", 0, [-400, -300, -200, -100]],
  ["stereo", "aresample=ochl=mono", 0, [-400, -300, -200, -100]],
  ["stereo", "aresample=ochl=stereo", 0, samples]
] as const) {
  for (const graph of [false, true]) {
    it(`${layout} with ${filter} matches native remix status and samples (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = new Volume();
      volume.writeFileSync("/in.raw", input);
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", layout, "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      const output = Buffer.concat(stdout);
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      if (status === 0) assert.equal(stderr, "");
    });
  }
}
