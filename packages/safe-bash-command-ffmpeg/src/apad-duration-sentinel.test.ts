import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, -901, 202, -802, 303, -703];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Native FFmpeg 7.0.2: -1 microsecond leaves a duration unset; zero is explicit.
for (const [options, limit, frames] of [
  ["pad_len=2:pad_dur=-0.000001", "0.001", 5],
  ["pad_dur=-1us:pad_len=2", "0.001", 5],
  ["whole_dur=-1us:whole_len=5", "0.003", 5],
  ["whole_len=5:whole_dur=-0.000001", "0.003", 5],
  ["pad_dur=-1us", "0.001", 8],
  ["whole_dur=-1us", "0.001", 8],
  ["pad_dur=-0.001ms:pad_len=2", "0.001", 5],
  ["pad_dur=0.001:pad_len=2:pad_dur=-1us", "0.003", 5],
  ["whole_dur=0.001:whole_len=5:whole_dur=-1us", "0.003", 5],
  ["pad_len=2:pad_dur=0", "0.001", 3],
  ["whole_len=5:whole_dur=0", "0.001", 3],
  ["whole_dur=0", "0.001", 3],
  ["pad_len=2", "0.001", 5],
  ["pad_dur=-2us:pad_len=2", "0.003", undefined],
  ["whole_dur=-2us:whole_len=5", "0.003", undefined],
  ["pad_dur=-1", "0.001", undefined],
  ["pad_dur=-1us", undefined, undefined],
  ["whole_dur=-1us", undefined, undefined]
] as const) {
  for (const graph of [false, true]) {
    it(`apad=${options} with ${limit ?? "no"} time limit (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `apad=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(limit === undefined ? [] : ["-t", limit]), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (frames === undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
          [...samples, ...Array<number>((frames - 3) * 2).fill(0)]);
      }
    });
  }
}
