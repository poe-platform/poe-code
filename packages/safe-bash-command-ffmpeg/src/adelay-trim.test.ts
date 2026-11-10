import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg references: samples are interleaved stereo; frames are [PTS, count].
for (const complex of [false, true]) {
  for (const [filter, samples, frames] of [
    ["atrim=start_sample=4,adelay=2S|3S,aselect='isnan(pts)'", [0, 0, 0, 0], [["NOPTS", "2"]]],
    ["atrim=start_sample=4,adelay=2S|3S", [0, 0, 0, 0, 5000, 0, 6000, -2500, 7000, -3000, 8000, -3500, 9000, -4000, 10000, -4500, 0, -5000],
      [["NOPTS", "2"], ["6", "2"], ["8", "3"], ["11", "1"], ["12", "1"]]],
    ["atrim=end_sample=0,adelay=0S|3S,atrim=end=0.007", [], []],
    ["atrim=end_sample=0,adelay=0S|3S", [0, 0, 0, 0, 0, 0], [["-9223372036854775807", "3"]]],
    ["atrim=end_sample=0,adelay=2S|3S", [0, 0, 0, 0, 0, 0], [["NOPTS", "2"], ["-9223372036854775804", "1"]]],
    ["atrim=start_sample=1,adelay=2S|3S,aselect='isnan(pts)'", [], []],
    ["atrim=start_sample=4,adelay=0S|3S", [5000, 0, 6000, 0, 7000, 0, 8000, -2500, 9000, -3000, 10000, -3500, 0, -4000, 0, -4500, 0, -5000],
      [["4", "2"], ["6", "3"], ["9", "1"], ["10", "3"]]],
    ["atrim=end_sample=0,adelay=0S|0S,atrim=end=0.007", [], []]
  ] as const) {
    it(`preserves generated silence timing: ${filter} (complex ${complex})`, async () => {
      const input = Buffer.alloc(40);
      for (let i = 0; i < 10; i++) {
        input.writeInt16LE((i + 1) * 1000, i * 4);
        input.writeInt16LE((i + 1) * -500, i * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=n=3:p=0,${filter},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), samples);
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
        const fields = line.split(" ");
        return [fields.find(field => field.startsWith("pts:"))!.slice(4),
          fields.find(field => field.startsWith("nb_samples:"))!.slice(11)];
      }), frames);
    });
  }
}
