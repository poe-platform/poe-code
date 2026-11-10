import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 10 }, (_, i) => [1000 * (i + 1), -500 * (i + 1)]);
const sourceFrames = [[0, 3], [3, 3], [6, 3], [9, 1]];

const unchanged = samples.map(([left], i) => [left, i < 3 ? 0 : -500 * (i - 2)])
  .concat([[0, -4000], [0, -4500], [0, -5000]]);

// FFmpeg 7.0.2 reference PCM and frame PTS/sample counts.
for (const [filter, expected, frames] of [
  ["asetnsamples=n=3:p=0,asendcmd=c=0.004 adelay@d delays 0S|5S,adelay@d=0S|3S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, -500], [5000, -1000],
      [6000, -1500], [7000, 0], [8000, 0], [9000, -2000], [10000, -2500],
      [0, -3000], [0, -3500], [0, -4000], [0, -4500], [0, -5000]],
    [...sourceFrames, [10, 5]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 0S|7S,adelay@d=0S|5S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, 0], [5000, 0],
      [6000, 0], [7000, 0], [8000, -1500], [9000, 0], [10000, 0],
      [0, -2000], [0, -2500], [0, -3000], [0, -3500], [0, -4000],
      [0, -4500], [0, -5000]],
    [...sourceFrames, [10, 7]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.006 adelay@d delays 0S|4S,adelay@d=0S|5S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, 0], [5000, 0],
      [6000, -500], [7000, -1500], [8000, -2000], [9000, -2500], [10000, -3000],
      [0, -3500], [0, -4000], [0, -4500], [0, -5000], [0, 0]],
    [...sourceFrames, [10, 5]]],
  ["asetnsamples=n=3:p=0,asendcmd=c='0.003 adelay@d delays 0S|5S;0.006 adelay@d delays 0S|2S;0.009 adelay@d delays 0S|0S',adelay@d=0S|3S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, 0], [5000, 0],
      [6000, -500], [7000, -2500], [8000, -3000], [9000, -3500], [10000, -5000],
      [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
    [...sourceFrames, [10, 5]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 2S,adelay@d=0S|3S:all=1",
    [[1000, 0], [2000, 0], [3000, 0], [0, -500], [0, -1000],
      [4000, -1500], [5000, -2000], [6000, -2500], [7000, -3000], [8000, -3500],
      [9000, -4000], [10000, -4500], [0, -5000]],
    [...sourceFrames, [10, 3]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay delays 0S|5S,adelay@d=0S|3S,adelay@other=0S|0S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, 0], [5000, 0],
      [6000, -500], [7000, -1000], [8000, -1500], [9000, -2000], [10000, -2500],
      [0, -3000], [0, -3500], [0, -4000], [0, -4500], [0, -5000]],
    [...sourceFrames, [10, 5]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 0S|5S,adelay@other=0S|0S,adelay@d=0S|3S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, 0], [5000, 0],
      [6000, -500], [7000, -1000], [8000, -1500], [9000, -2000], [10000, -2500],
      [0, -3000], [0, -3500], [0, -4000], [0, -4500], [0, -5000]],
    [...sourceFrames, [10, 5]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 2S|invalid,adelay@d=0S|3S",
    [[1000, 0], [2000, 0], [3000, 0], [0, -500], [0, -1000],
      [4000, -1500], [5000, -2000], [6000, -2500], [7000, -3000], [8000, -3500],
      [9000, -4000], [10000, -4500], [0, -5000]],
    [...sourceFrames, [10, 3]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 0S|5S,adelay@d=0S|3S",
    [[1000, 0], [2000, 0], [3000, 0], [4000, 0], [5000, 0], [6000, -500],
      [7000, -1000], [8000, -1500], [9000, -2000], [10000, -2500],
      [0, -3000], [0, -3500], [0, -4000], [0, -4500], [0, -5000]], [...sourceFrames, [10, 5]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 2S|1S,adelay@d=0S|3S",
    [[1000, 0], [2000, 0], [3000, 0], [0, -1500], [0, -2000], [4000, -2500],
      [5000, -3000], [6000, -3500], [7000, -4000], [8000, -4500],
      [9000, -5000], [10000, 0], [0, 0]], [...sourceFrames, [10, 3]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@other delays 0S|1S,adelay@d=0S|3S",
    unchanged, [...sourceFrames, [10, 3]]],
  ["asetnsamples=n=3:p=0,adelay@d=0S|3S", unchanged, [...sourceFrames, [10, 3]]],
  ["asetnsamples=n=3:p=0,asendcmd=c=0.003 volume@v volume 0,volume@v=1",
    samples.map((pair, i) => i < 3 ? pair : [0, 0]), sourceFrames]
] as const) {
  for (const graph of [false, true]) {
    it(`scheduled adelay commands: ${filter} (${graph ? "graph" : "simple"})`, async () => {
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

for (const graph of [false, true]) {
  it(`bounds runtime delay growth before replacing output (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/in.raw": Buffer.alloc(40), "/out.raw": "KEEP" });
    const filter = "asetnsamples=n=3:p=0,asendcmd=c=0.003 adelay@d delays 0S|5S,adelay@d=0S|3S";
    let stderr = "";
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.014 } }).execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(stderr.includes("maxDurationSeconds"), stderr);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}
