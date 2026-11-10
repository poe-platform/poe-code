import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 10 }, (_, i) => [1000 * (i + 1), -500 * (i + 1)]);
const sourceFrames = [[0, 3], [3, 3], [6, 3], [9, 1]];

// Native FFmpeg keeps packet positions on input-backed frames, including zero
// delay, but leaves generated leading silence and the drained tail unpositioned.
for (const [filter, expected, frames] of [
  ["asetnsamples=n=3:p=0,anull,adelay=0S|3S,aselect='not(isnan(pos))'",
    [[1000, 0], [2000, 0], [3000, 0], [4000, -500], [5000, -1000],
      [6000, -1500], [7000, -2000], [8000, -2500], [9000, -3000], [10000, -3500]], sourceFrames],
  ["asetnsamples=n=3:p=0,ametadata=mode=add:key=k:value=v,adelay=0S|3S,aselect='isnan(pos)'",
    [[0, -4000], [0, -4500], [0, -5000]], [[10, 3]]],
  ["asetnsamples=n=3:p=0,ametadata=mode=add:key=k:value=v,adelay=0S|0S,aselect='not(isnan(pos))'",
    samples, sourceFrames],
  ["asetnsamples=n=3:p=0,anull,anull,aselect='not(isnan(pos))'", samples, sourceFrames],
  ["asetnsamples=n=3:p=0,ametadata=mode=add:key=k:value=v,adelay,aselect='isnan(pos)'", [], []],
  ["asetnsamples=n=3:p=0,adelay=3S|3S,aselect='not(isnan(pos))'",
    samples, [[3, 3], [6, 3], [9, 3], [12, 1]]],
  ["asetnsamples=n=3:p=0,adelay=3S|3S,adelay=0S|0S,aselect='isnan(pos)'",
    [[0, 0], [0, 0], [0, 0]], [[0, 3]]],
  ["adelay=0S|0S,aselect='eq(pos,0)'", samples, [[0, 10]]]
] as const) {
  for (const graph of [false, true]) {
    it(`adelay preserves source positions: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(samples.length * 4);
      for (const [i, pair] of samples.entries()) {
        input.writeInt16LE(pair[0]!, i * 4);
        input.writeInt16LE(pair[1]!, i * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const chain = `${filter},ashowinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(stdout);
      assert.deepEqual(Array.from({ length: output.length / 4 }, (_, i) =>
        [output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)]), expected);
      const actualFrames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo] ")).map(line => {
        const fields = Object.fromEntries(line.split(" ").map(field => field.split(":")));
        return [Number(fields.pts), Number(fields.nb_samples)];
      });
      assert.deepEqual(actualFrames, frames, stderr);
    });
  }
}
