import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputSamples = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
// Native FFmpeg advances areverse PTS by the frame sample count in time-base ticks.
for (const complex of [false, true]) {
  for (const [filter, expectedSamples, expectedPts] of [
    ["asettb=1/1000,areverse", [...inputSamples].reverse(), [0, 1, 4, 7]],
    ["asettb=1/16000,areverse", [...inputSamples].reverse(), [0, 1, 4, 7]],
    ["asettb=1/1000,areverse,aselect='eq(pts,1)'", [9000, 8000, 7000], [1]],
    ["asettb=1/16000,areverse,aselect='eq(pts,1)'", [9000, 8000, 7000], [1]],
    ["asettb=1/8000,areverse", [...inputSamples].reverse(), [0, 1, 4, 7]],
    ["asettb=1/1000", inputSamples, [0, 0, 1, 1]],
    ["asettb=1/1000,asetpts=PTS+5,areverse", [...inputSamples].reverse(), [5, 6, 9, 12]]
  ] as const) {
    it(`preserves downstream timing through ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(inputSamples.length * 2);
      for (const [i, sample] of inputSamples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,${filter},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "/out.dat"],
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
      const output = volume.readFileSync("/out.dat") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expectedSamples);
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line =>
        Number(line.split(" ").find(field => field.startsWith("pts:"))!.slice(4))), expectedPts);
    });
  }
}
