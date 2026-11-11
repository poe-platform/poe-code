import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [12000, 4000, -8000, 3000, 0, -4000, 1600, 0];
// Captured from native FFmpeg with stereo s16le input/output at 8000 Hz.
const cases: [string, readonly number[] | undefined][] = [
  ["stereotools=balance_in=1:mode=lr>rl", [4000, 0, 3000, 0, -4000, 0, 0, 0]],
  ["stereotools=mode=lr>rl:balance_out=1", [0, 12000, 0, -8000, 0, 0, 0, 1600]],
  ["stereotools=balance_in=-1:mode=lr>rl", [0, 12000, 0, -8000, 0, 0, 0, 1600]],
  ["stereotools=mode=lr>rl:balance_out=-1", [4000, 0, 3000, 0, -4000, 0, 0, 0]],
  ["stereotools=balance_in=0:balance_out=0", [12000, 4000, -8000, 3000, 0, -4000, 1600, 0]],
  ["stereotools=balance_in=1/2:mode=lr>ms:balance_out=-0.5:level_in=2:level_out=0.5:phasel=1", [-5000, 500, 500, -1750, 2000, 1000, -400, 200]],
  ["stereotools=balance_in=-1:bmode_in=balance:mode=lr>rl", [0, 12000, 0, -8000, 0, 0, 0, 1600]],
  ["stereotools=balance_in=-0.25:bmode_in=balance:mode=lr>rl", [3000, 12000, 2250, -8000, -3000, 0, 0, 1600]],
  ["stereotools=balance_in=0:bmode_in=balance:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_in=0.25:bmode_in=balance:mode=lr>rl", [4000, 9000, 3000, -6000, -4000, 0, 0, 1200]],
  ["stereotools=balance_in=1:bmode_in=balance:mode=lr>rl", [4000, 0, 3000, 0, -4000, 0, 0, 0]],
  ["stereotools=balance_in=-1:bmode_in=amplitude:mode=lr>rl", [0, 24000, 0, -16000, 0, 0, 0, 3200]],
  ["stereotools=balance_in=-0.25:bmode_in=amplitude:mode=lr>rl", [3000, 15000, 2250, -10000, -3000, 0, 0, 2000]],
  ["stereotools=balance_in=0:bmode_in=amplitude:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_in=0.25:bmode_in=amplitude:mode=lr>rl", [5000, 9000, 3750, -6000, -5000, 0, 0, 1200]],
  ["stereotools=balance_in=1:bmode_in=amplitude:mode=lr>rl", [8000, 0, 6000, 0, -8000, 0, 0, 0]],
  ["stereotools=balance_in=-1:bmode_in=power:mode=lr>rl", [2000, 24000, 1500, -16000, -2000, 0, 0, 3200]],
  ["stereotools=balance_in=-0.25:bmode_in=power:mode=lr>rl", [3000, 16000, 2250, -10667, -3000, 0, 0, 2133]],
  ["stereotools=balance_in=0:bmode_in=power:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_in=0.25:bmode_in=power:mode=lr>rl", [5333, 9000, 4000, -6000, -5333, 0, 0, 1200]],
  ["stereotools=balance_in=1:bmode_in=power:mode=lr>rl", [8000, 6000, 6000, -4000, -8000, 0, 0, 800]],
  ["stereotools=balance_in=-1:bmode_in=0:mode=lr>rl", [0, 12000, 0, -8000, 0, 0, 0, 1600]],
  ["stereotools=balance_in=-0.25:bmode_in=0:mode=lr>rl", [3000, 12000, 2250, -8000, -3000, 0, 0, 1600]],
  ["stereotools=balance_in=0:bmode_in=0:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_in=0.25:bmode_in=0:mode=lr>rl", [4000, 9000, 3000, -6000, -4000, 0, 0, 1200]],
  ["stereotools=balance_in=1:bmode_in=0:mode=lr>rl", [4000, 0, 3000, 0, -4000, 0, 0, 0]],
  ["stereotools=balance_in=-1:bmode_in=1:mode=lr>rl", [0, 24000, 0, -16000, 0, 0, 0, 3200]],
  ["stereotools=balance_in=-0.25:bmode_in=1:mode=lr>rl", [3000, 15000, 2250, -10000, -3000, 0, 0, 2000]],
  ["stereotools=balance_in=0:bmode_in=1:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_in=0.25:bmode_in=1:mode=lr>rl", [5000, 9000, 3750, -6000, -5000, 0, 0, 1200]],
  ["stereotools=balance_in=1:bmode_in=1:mode=lr>rl", [8000, 0, 6000, 0, -8000, 0, 0, 0]],
  ["stereotools=balance_in=-1:bmode_in=2:mode=lr>rl", [2000, 24000, 1500, -16000, -2000, 0, 0, 3200]],
  ["stereotools=balance_in=-0.25:bmode_in=2:mode=lr>rl", [3000, 16000, 2250, -10667, -3000, 0, 0, 2133]],
  ["stereotools=balance_in=0:bmode_in=2:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_in=0.25:bmode_in=2:mode=lr>rl", [5333, 9000, 4000, -6000, -5333, 0, 0, 1200]],
  ["stereotools=balance_in=1:bmode_in=2:mode=lr>rl", [8000, 6000, 6000, -4000, -8000, 0, 0, 800]],
  ["stereotools=balance_out=-1:bmode_out=balance:mode=lr>rl", [4000, 0, 3000, 0, -4000, 0, 0, 0]],
  ["stereotools=balance_out=-0.25:bmode_out=balance:mode=lr>rl", [4000, 9000, 3000, -6000, -4000, 0, 0, 1200]],
  ["stereotools=balance_out=0:bmode_out=balance:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_out=0.25:bmode_out=balance:mode=lr>rl", [3000, 12000, 2250, -8000, -3000, 0, 0, 1600]],
  ["stereotools=balance_out=1:bmode_out=balance:mode=lr>rl", [0, 12000, 0, -8000, 0, 0, 0, 1600]],
  ["stereotools=balance_out=-1:bmode_out=amplitude:mode=lr>rl", [8000, 0, 6000, 0, -8000, 0, 0, 0]],
  ["stereotools=balance_out=-0.25:bmode_out=amplitude:mode=lr>rl", [5000, 9000, 3750, -6000, -5000, 0, 0, 1200]],
  ["stereotools=balance_out=0:bmode_out=amplitude:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_out=0.25:bmode_out=amplitude:mode=lr>rl", [3000, 15000, 2250, -10000, -3000, 0, 0, 2000]],
  ["stereotools=balance_out=1:bmode_out=amplitude:mode=lr>rl", [0, 24000, 0, -16000, 0, 0, 0, 3200]],
  ["stereotools=balance_out=-1:bmode_out=power:mode=lr>rl", [8000, 6000, 6000, -4000, -8000, 0, 0, 800]],
  ["stereotools=balance_out=-0.25:bmode_out=power:mode=lr>rl", [5333, 9000, 4000, -6000, -5333, 0, 0, 1200]],
  ["stereotools=balance_out=0:bmode_out=power:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_out=0.25:bmode_out=power:mode=lr>rl", [3000, 16000, 2250, -10667, -3000, 0, 0, 2133]],
  ["stereotools=balance_out=1:bmode_out=power:mode=lr>rl", [2000, 24000, 1500, -16000, -2000, 0, 0, 3200]],
  ["stereotools=balance_out=-1:bmode_out=0:mode=lr>rl", [4000, 0, 3000, 0, -4000, 0, 0, 0]],
  ["stereotools=balance_out=-0.25:bmode_out=0:mode=lr>rl", [4000, 9000, 3000, -6000, -4000, 0, 0, 1200]],
  ["stereotools=balance_out=0:bmode_out=0:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_out=0.25:bmode_out=0:mode=lr>rl", [3000, 12000, 2250, -8000, -3000, 0, 0, 1600]],
  ["stereotools=balance_out=1:bmode_out=0:mode=lr>rl", [0, 12000, 0, -8000, 0, 0, 0, 1600]],
  ["stereotools=balance_out=-1:bmode_out=1:mode=lr>rl", [8000, 0, 6000, 0, -8000, 0, 0, 0]],
  ["stereotools=balance_out=-0.25:bmode_out=1:mode=lr>rl", [5000, 9000, 3750, -6000, -5000, 0, 0, 1200]],
  ["stereotools=balance_out=0:bmode_out=1:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_out=0.25:bmode_out=1:mode=lr>rl", [3000, 15000, 2250, -10000, -3000, 0, 0, 2000]],
  ["stereotools=balance_out=1:bmode_out=1:mode=lr>rl", [0, 24000, 0, -16000, 0, 0, 0, 3200]],
  ["stereotools=balance_out=-1:bmode_out=2:mode=lr>rl", [8000, 6000, 6000, -4000, -8000, 0, 0, 800]],
  ["stereotools=balance_out=-0.25:bmode_out=2:mode=lr>rl", [5333, 9000, 4000, -6000, -5333, 0, 0, 1200]],
  ["stereotools=balance_out=0:bmode_out=2:mode=lr>rl", [4000, 12000, 3000, -8000, -4000, 0, 0, 1600]],
  ["stereotools=balance_out=0.25:bmode_out=2:mode=lr>rl", [3000, 16000, 2250, -10667, -3000, 0, 0, 2133]],
  ["stereotools=balance_out=1:bmode_out=2:mode=lr>rl", [2000, 24000, 1500, -16000, -2000, 0, 0, 3200]],
  ["stereotools=balance_out=0.5:bmode_out=power", [6000, 8000, -4000, 6000, 0, -8000, 800, 0]],
  ["stereotools=balance_in=0.5:bmode_in=power:delay=0.5:mode=lr>ms:balance_out=-0.5:bmode_out=amplitude:muter=1", [10500, 0, 1500, 0, -6000, 0, 600, 0]]
];
for (const side of ["in", "out"]) {
  for (const [value, expected] of [
    ["1+1", [6000, 8000, -4000, 6000, 0, -8000, 800, 0]],
    ["1.5", [6000, 8000, -4000, 6000, 0, -8000, 800, 0]],
    ["max", [6000, 8000, -4000, 6000, 0, -8000, 800, 0]],
    ["power-1", [6000, 6000, -4000, 4500, 0, -6000, 800, 0]],
    ...["0.5", "default", "min"].map(value => [value, [6000, 4000, -4000, 3000, 0, -4000, 800, 0]] as const)
  ] as const) {
    cases.push([`stereotools=bmode_${side}=${value}:balance_${side}=0.5`, expected]);
  }
}
for (const key of ["balance_in", "balance_out"]) {
  for (const value of ["", "-1.001", "1.001", "2", "NaN", "Infinity", "bad"]) {
    cases.push([`stereotools=${key}=${value}`, undefined]);
  }
}
for (const key of ["bmode_in", "bmode_out"]) {
  for (const value of ["", "-1", "-0.1", "2.1", "2.5", "3", "1/0", "NaN", "Infinity", "bad"]) {
    cases.push([`stereotools=${key}=${value}`, undefined]);
  }
}
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native stereo balance PCM (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (!expected) {
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("stereotools"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
    });
  }
}
