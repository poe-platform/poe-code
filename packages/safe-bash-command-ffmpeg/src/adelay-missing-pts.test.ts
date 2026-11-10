import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 10 }, (_, i) => [(i + 1) * 1000, (i + 1) * -500]).flat();
const delayed = [1000, 0, 2000, 0, 3000, 0, 4000, -500, 5000, -1000, 6000, -1500,
  7000, -2000, 8000, -2500, 9000, -3000, 10000, -3500, 0, -4000, 0, -4500, 0, -5000];
// Native FFmpeg 7.0.2: source frames rescale missing PTS to INT64_MIN + 1;
// initial silence retains NOPTS and the EOF tail advances the last source PTS.
for (const complex of [false, true]) {
  for (const [filter, samples, frames] of [
    ["asetpts=NAN,adelay=0S|3S,aselect='isnan(pts)'", [], []],
    ["asetpts=NAN,adelay=2S|3S,aselect='isnan(pts)'", [0, 0, 0, 0], [["NOPTS", "2"]]],
    ["asetpts=NAN,adelay=0S|3S", delayed, [
      ["-9223372036854775807", "3"], ["-9223372036854775807", "3"],
      ["-9223372036854775807", "3"], ["-9223372036854775807", "1"], ["-9223372036854775806", "3"]]],
    ["asetpts=NAN,adelay=0S|3S,aselect=1", delayed, [
      ["-9223372036854775807", "3"], ["-9223372036854775807", "3"],
      ["-9223372036854775807", "3"], ["-9223372036854775807", "1"], ["-9223372036854775806", "3"]]],
    ["asetpts=NAN,adelay=0S|3S,asetpts=N", delayed,
      [["0", "3"], ["3", "3"], ["6", "3"], ["9", "1"], ["10", "3"]]],
    ["asetpts=NAN,anull,aselect='isnan(pts)'", input,
      [["NOPTS", "3"], ["NOPTS", "3"], ["NOPTS", "3"], ["NOPTS", "1"]]],
    ["anull,adelay=0S|3S", delayed, [["0", "3"], ["3", "3"], ["6", "3"], ["9", "1"], ["10", "3"]]]
  ] as const) {
    it(`matches native missing delay timestamps: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const bytes = Buffer.alloc(input.length * 2);
      input.forEach((sample, i) => bytes.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": bytes, "/out.raw": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,${filter},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), samples);
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
        const fields = line.split(" ");
        return [fields.find(field => field.startsWith("pts:"))!.slice(4),
          fields.find(field => field.startsWith("nb_samples:"))!.slice(11)];
      }), frames);
    });
  }
}
