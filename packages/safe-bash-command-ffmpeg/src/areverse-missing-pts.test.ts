import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputSamples = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
// FFmpeg 7.0.2 emits NOPTS first, then INT64_MIN plus the samples already emitted.
const reversedPts = ["NOPTS", "-9223372036854775805", "-9223372036854775801"];
for (const complex of [false, true]) {
  for (const [filter, expectedSamples, expectedPts] of [
    ["asetpts=NAN,areverse,volume='isnan(t)':eval=frame", [111, 110, 109, 0, 0, 0, 0, 0, 0, 0, 0], reversedPts],
    ["asetpts=NAN,areverse", [...inputSamples].reverse(), reversedPts],
    ["asetpts=NAN", inputSamples, ["NOPTS", "NOPTS", "NOPTS"]],
    ["areverse", [...inputSamples].reverse(), ["0", "3", "7"]],
    ["asetpts=NAN,volume='isnan(t)':eval=frame", inputSamples, ["NOPTS", "NOPTS", "NOPTS"]],
    ["areverse,volume='isnan(t)':eval=frame", Array<number>(11).fill(0), ["0", "3", "7"]]
  ] as const) {
    it(`preserves downstream timing through ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(inputSamples.length * 2);
      for (const [i, sample] of inputSamples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const chain = `asetnsamples=n=4:p=0,${filter},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
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
        line.split(" ").find(field => field.startsWith("pts:"))!.slice(4)), expectedPts);
    });
  }
}
