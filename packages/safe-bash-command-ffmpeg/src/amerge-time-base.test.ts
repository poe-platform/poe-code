import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, 102, 103, 104, 105, 106, 107, 108, 109];

// Native FFmpeg 7.0.2: output PTS use the first connected input's time base.
for (const [timeBase, filter, expectedSamples, expectedFrames] of [
  ["3/1000", "aselect=eq(pts\\,1)", samples.slice(2, 6), [[1, 1], [1, 1], [1, 2]]],
  ["1/100", "atrim=start_pts=2:end_pts=6", [], []],
  ["3/1000", "anull", samples, [[0, 2], [1, 1], [1, 1], [1, 2], [2, 2], [3, 1]]],
  ["2/1000", "anull", samples, [[0, 2], [1, 1], [2, 1], [3, 2], [3, 2], [4, 1]]],
  ["1/2000", "anull", samples, [[0, 2], [4, 1], [6, 1], [8, 2], [12, 2], [16, 1]]],
  ["1/1000", "aselect=eq(pts\\,3)", [104], [[3, 1]]]
] as const) {
  for (const reverse of [false, true]) {
    it(`amerge retains ${timeBase} timing through ${filter} (reversed=${reverse})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const first = reverse ? 1 : 0;
      const graph = `[${first}:a]asetnsamples=n=3:p=0,asettb=${timeBase}[x];`
        + `[${1 - first}:a]asetnsamples=n=2:p=0[y];[x][y]amerge,${filter},ashowinfo`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", ...[0, 1].flatMap(() =>
          ["-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw"]),
          "-filter_complex", graph, "-f", "s16le", "pipe:1"],
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
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(stdout);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        expectedSamples.flatMap(value => [value, value]));
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
        const fields = line.split(" ");
        return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
          Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
      }), expectedFrames);
    });
  }
}
