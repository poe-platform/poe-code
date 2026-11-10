import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg evaluates constants before rounding the requested sample count.
for (const [options, limit, frames] of [
  ["whole_len=PI*2", "0.001", 6],
  ["whole_len=E*2", "0.001", 5],
  ["whole_len=PHI*3", "0.001", 5],
  ["pad_len=PI", "0.003", 6],
  ["pad_len=E", "0.001", 6],
  ["pad_len=PHI", "0.001", 5],
  ["pad_len=2+1", "0.001", 6],
  ["pad_len=pi", "0.001", null],
  ["whole_len=-PI", "0.001", null],
  ["pad_dur=PI", "0.001", null]
] as const) {
  for (const graph of [false, true]) {
    it(`apad=${options} handles constants (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      const samples = [101, -901, 202, -802, 303, -703];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
      volume.writeFileSync("/in.raw", input);
      const filter = `apad=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-t", limit, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (frames === null) {
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
