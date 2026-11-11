import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 32 }, (_, i) => i % 2 === 0 ? 1000 + i * 231 : -300 - i * 111);
// Full PCM16 output from native FFmpeg 7.0.2 at 8 kHz, in four-sample stereo frames.
const cases = [
  ["phase", "90", "", [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 1299, 2848, 1521, 3310, 1743, 3772, 1965, 4234, 2187, 4696, 2409, 5158, 2631, 5620, 2853, 6082, 3075, 6544, 3297, 7006, 3519, 7468, 3741, 7930]],
  ["base", "1", "", [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 6995, -5446, 8141, -6352, 9287, -7258, 10433, -8164, 11579, -9070, 12725, -9976, 13871, -10882, 15017, -11788, 16163, -12694, 17309, -13600, 18455, -14506, 19601, -15412]],
  ["balance_in", "1", "", [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 0, -1299, 0, -1521, 0, -1743, 0, -1965, 0, -2187, 0, -2409, 0, -2631, 0, -2853, 0, -3075, 0, -3297, 0, -3519, 0, -3741]],
  ["sclevel", "40", "softclip=1", [1273, -523, 1860, -806, 2447, -1088, 3033, -1371, 27361, -21371, 28155, -22825, 28764, -23984, 29246, -24925, 29637, -25700, 29959, -26349, 30230, -26899, 30460, -27371, 30658, -27779, 30830, -28135, 30982, -28449, 31116, -28728]],
  ["level_out", "2", "", [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 5696, -2598, 6620, -3042, 7544, -3486, 8468, -3930, 9392, -4374, 10316, -4818, 11240, -5262, 12164, -5706, 13088, -6150, 14012, -6594, 14936, -7038, 15860, -7482]]
] as const;

for (const graph of [false, true]) {
  for (const [key, value, initial, expected] of cases) {
    it(`timed stereotools ${key} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      assert.deepEqual(await run(`asendcmd=c='0.0005 stereotools ${key} ${value}',stereotools${initial ? `=${initial}` : ""}`, graph), expected);
    });
  }

  for (const [key, value, initial] of [
    ["phase", "max/4", ""], ["base", "-0.5", ""],
    ["balance_in", "-0.5", "mode=lr>ms"], ["balance_out", "0.5", "mode=lr>rl"],
    ["mpan", "0.5", ""], ["sbal", "-0.5", ""],
    ["bmode_in", "power", "balance_in=0.5"], ["bmode_out", "amplitude", "balance_out=-0.5"],
    ["sclevel", "40", "softclip=1"]
  ]) {
    it(`timed stereotools ${key} preserves state after invalid updates and resets (${graph ? "graph" : "simple"})`, async () => {
      const filter = `stereotools@mix${initial ? `=${initial}` : ""}`;
      const before = await run(filter, graph);
      const after = await run(`${filter}${initial ? ":" : "="}${key}=${value}`, graph);
      const commands = `0.00001 stereotools@mix ${key} ${value};0.001 stereotools@mix ${key} 999;0.0015 stereotools@mix ${key} default`;
      assert.deepEqual(await run(`asendcmd=c='${commands}',${filter}`, graph),
        [...before.slice(0, 8), ...after.slice(8, 24), ...before.slice(24)]);
    });
  }
}

async function run(filter: string, graph: boolean): Promise<number[]> {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chain = `asetnsamples=n=4:p=0,${filter}`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = Buffer.concat(output);
  return Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
}
