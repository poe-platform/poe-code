import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 10 }, (_, i) => [(i + 1) * 1000, (i + 1) * -500]);
const delayed = Array.from({ length: 13 }, (_, i) => [samples[i]?.[0] ?? 0, samples[i - 3]?.[1] ?? 0]);
const input = Buffer.alloc(samples.length * 4);
samples.flat().forEach((sample, i) => input.writeInt16LE(sample!, i * 2));

// Native FFmpeg 7.0.2: adelay outputs sample-rate ticks, including explicit zero delay.
for (const graph of [false, true]) {
  for (const [filter, expectedSamples, expectedFrames] of [
    ["asettb=1/2000,adelay=0S|3S,aselect='eq(pts,3)'", delayed.slice(3, 6), [[3, 3]]],
    ["asettb=1/500,adelay=0S|3S", delayed, [[0, 3], [4, 3], [6, 3], [10, 1], [11, 3]]],
    ["asettb=1/2000,adelay=0S|0S", samples, [[0, 3], [3, 3], [6, 3], [9, 1]]],
    ["asettb=1/2000,adelay=0S|0S,aselect='eq(pts,3)'", samples.slice(3, 6), [[3, 3]]],
    ["asettb=1/2000,adelay", samples, [[0, 3], [3, 3], [6, 3], [9, 1]]],
    ["asettb=1/2000,adelay=0S|3S:enable=0", [...samples, [0, 0], [0, 0], [0, 0]], [[0, 3], [3, 3], [6, 3], [9, 1], [0, 3]]],
    ["asettb=1/2000,asetpts=PTS+1,adelay=0S|3S", delayed, [[1, 3], [4, 3], [7, 3], [10, 1], [11, 3]]],
    ["asettb=1/2000,asetpts=PTS-1,adelay=0S|3S", delayed, [[-1, 3], [3, 3], [6, 3], [9, 1], [10, 3]]],
    ["asettb=1/2000,asetpts=PTS+1,adelay=0S|3S,aselect='eq(t,0.001)'", delayed.slice(0, 3), [[1, 3]]],
    ["asettb=1/2000,asetpts=PTS+1,adelay,aselect='eq(t,0.001)'", samples.slice(0, 3), [[1, 3]]],
    ["anull,adelay=0S|3S", delayed, [[0, 3], [3, 3], [6, 3], [9, 1], [10, 3]]],
    ["asettb=1/2000,anull", samples, [[0, 3], [6, 3], [12, 3], [18, 1]]]
  ] as const) {
    it(`adelay frame timing through ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,${filter},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 4 }, (_, i) =>
        [output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)]), expectedSamples);
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line =>
        ["pts:", "nb_samples:"].map(prefix => Number(line.split(" ").find(field => field.startsWith(prefix))!.slice(prefix.length)))),
      expectedFrames);
    });
  }
}
