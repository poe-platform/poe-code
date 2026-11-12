import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 24 }, (_, i) => [12000, -1000, 0, 5000, -8000, 20000][i % 6]!);
// Complete PCM16 output from native FFmpeg with three eight-sample frames at 8 kHz.
const unchanged = [240, 838, 1354, 1657, 1758, 1862, 2663, 3826, 4466, 4597, 4353, 4027, 4378, 5115, 5377, 5194, 4699, 4185, 4403, 5053, 5264, 5057, 4558, 4053];
const changed = [240, 838, 1354, 1657, 1758, 1862, 2663, 3826, 3079, 1370, 361, 1560, 8860, 11801, 5472, 805, -400, 1325, 8911, 11874, 5495, 801, -407, 1323];
for (const graph of [false, true]) {
  for (const [commands, filter, expected] of [
    ["0.001 lowpass@one f 1500", "lowpass@one=f=400", changed],
    ["0.001 lowpass@one f 3000/2;0.002 lowpass@one f invalid", "lowpass@one=f=400", changed],
    ["0.001 lowpass f 1500", "lowpass@one=f=400,lowpass@two=f=0", changed],
    ["0.001 lowpass@two f 1500", "lowpass@one=f=0,lowpass@two=f=400", changed],
    ["0.001 lowpass@one frequency 1500", "lowpass@one=f=400", changed],
    ["0.0015 lowpass@one f 1500", "lowpass@one=f=400", [240, 838, 1354, 1657, 1758, 1862, 2663, 3826, 4466, 4597, 4353, 4027, 4378, 5115, 5377, 5194, 1650, 1355, 8495, 11675, 5490, 840, -388, 1324]],
    ["0.001 highpass@one f 1500", "highpass@one=f=400", [9606, -5018, -2786, 2071, -9390, 16837, 3483, -9362, 789, 4000, -5839, 13601, -7532, -8428, 3531, 5074, -5917, 13340, -7636, -8422, 3556, 5084, -5918, 13338]],
    ["0.001 bass@one g 10", "bass@one=g=2", [12076, -852, 140, 5171, -7849, 20225, 12427, -505, 199, 5120, -8197, 19993, 12870, 98, 950, 6003, -7195, 21101, 14071, 1382, 2304, 7419, -5728, 22611]],
    ["0.001 bass@one gain 10", "bass@one=g=2", [12076, -852, 140, 5171, -7849, 20225, 12427, -505, 199, 5120, -8197, 19993, 12870, 98, 950, 6003, -7195, 21101, 14071, 1382, 2304, 7419, -5728, 22611]],
    ["0.001 lowpass@other f 1500", "lowpass@one=f=400", unchanged],
    ["0.001 lowpass@one f invalid;0.002 lowpass@one f -1", "lowpass@one=f=400", unchanged],
    ["", "lowpass@one=f=400", unchanged],
    ["", "lowpass@one=f=1500", [2240, 5330, 3864, 1418, 219, 1484, 8855, 11815, 5479, 806, -402, 1324, 8911, 11874, 5495, 801, -407, 1323, 8912, 11875, 5495, 801, -407, 1323]]
  ] as const) {
    it(`biquad commands ${commands || filter} (${graph ? "graph" : "simple"})`, async () => {
      const chain = `asetnsamples=n=8:p=0,${commands ? `asendcmd=c='${commands}',` : ""}${filter}`;
      assert.deepEqual(await run(chain, graph), expected);
    });
  }
}

for (const graph of [false, true]) {
  it(`biquad commands preserve independent stereo history (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asetnsamples=n=8:p=0,asendcmd=c='0.001 lowpass@one f 1500',lowpass@one=f=400", graph, 2),
      changed.flatMap(sample => [sample, sample]));
  });
}

async function run(chain: string, graph: boolean, channels = 1): Promise<number[]> {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: channels }, () => Float64Array.from(input, sample => sample / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
    "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = Buffer.from(await fs.readFile("/out.pcm"));
  return Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}
