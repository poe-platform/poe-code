import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 19 }, (_, i) => 101 + i);
// FFmpeg 7.0.2 multiplies integer PTS by TB: 9 * (1 / 1000) !== 0.009.
for (const complex of [false, true]) {
  for (const [expression, expected] of [
    ["eq(t,0.009)", []],
    ["gt(t,0.009)", samples.slice(9)],
    ["eq(t,9*TB)", samples.slice(9, 12)],
    ["eq(pts,9)", samples.slice(9, 12)],
    ["eq(t,0.003)", samples.slice(3, 6)],
    ["eq(t,0.012)", samples.slice(12, 15)],
    ["eq(prev_t,9*TB)", samples.slice(12, 15)],
    ["eq(n,3)+eq(prev_selected_t,9*TB)", samples.slice(9, 15)]
  ] as const) {
    it(`aselect time boundary ${expression} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=n=3:p=0,aselect='${expression}'`;
      let stderr = "";
      const chunks: Buffer[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
