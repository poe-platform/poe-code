import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg references include all PCM samples and ashowinfo frame properties.
for (const graph of [false, true]) {
  for (const scenario of [
    { prefix: "asetnsamples=n=3:p=0,", enable: "not(isnan(pos))", delayed: true,
      frames: [[0, 3], [3, 3], [6, 3], [9, 1], [10, 3]] },
    { prefix: "asetnsamples=n=3:p=0,", enable: "isnan(pos)", delayed: false,
      frames: [[0, 3], [3, 3], [6, 3], [9, 1], [0, 3]] },
    { prefix: "", enable: "not(isnan(pos))", delayed: true,
      frames: [[0, 10], [10, 3]] },
    { prefix: "asetnsamples=n=3:p=0,", enable: "1", delayed: true,
      frames: [[0, 3], [3, 3], [6, 3], [9, 1], [10, 3]] }
  ]) {
    const filter = `${scenario.prefix}adelay=0S|3S:enable=${scenario.enable},ashowinfo`;
    it(`adelay retains source positions after reframing: ${filter} (graph ${graph})`, async () => {
      const input = Buffer.alloc(10 * 4);
      for (let i = 1; i <= 10; i++) {
        input.writeInt16LE(1000 * i, (i - 1) * 4);
        input.writeInt16LE(-500 * i, (i - 1) * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(chunks);
      const pairs = Array.from({ length: output.length / 4 }, (_, i) =>
        [output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)]);
      assert.deepEqual(pairs, scenario.delayed ? [
        [1000, 0], [2000, 0], [3000, 0], [4000, -500], [5000, -1000],
        [6000, -1500], [7000, -2000], [8000, -2500], [9000, -3000],
        [10000, -3500], [0, -4000], [0, -4500], [0, -5000]
      ] : [
        [1000, -500], [2000, -1000], [3000, -1500], [4000, -2000], [5000, -2500],
        [6000, -3000], [7000, -3500], [8000, -4000], [9000, -4500],
        [10000, -5000], [0, 0], [0, 0], [0, 0]
      ]);
      const frames = stderr.split("\n").filter(line => line.includes("[ashowinfo]"));
      assert.equal(frames.length, scenario.frames.length, stderr);
      for (const [n, [pts, count]] of scenario.frames.entries()) {
        for (const property of [`n:${n}`, `pts:${pts}`, `pts_time:${pts! / 1000}`,
          "channels:2", "chlayout:stereo", "rate:1000", `nb_samples:${count}`]) {
          assert.ok(frames[n]!.split(" ").includes(property), frames[n]);
        }
      }
    });
  }
}
