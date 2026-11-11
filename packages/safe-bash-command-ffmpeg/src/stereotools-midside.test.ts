import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [12000, 4000, -8000, 3000, 0, -4000, 1600, 0];
// Captured from native FFmpeg with stereo s16le input/output at 8000 Hz.
const cases: [string, readonly number[] | undefined][] = [
  ["stereotools=mlev=0.5", [8000, 0, -6750, 4250, 1000, -3000, 1200, -400]],
  ["stereotools=slev=0.5", [10000, 6000, -5250, 250, -1000, -3000, 1200, 400]],
  ["stereotools=mpan=0.5", [8000, 4000, -6750, 3000, 1000, -4000, 1200, 0]],
  ["stereotools=sbal=0.5", [10000, 4000, -5250, 3000, -1000, -4000, 1200, 0]],
  ["stereotools=mpan=-0.5", [12000, 0, -8000, 4250, 0, -3000, 1600, -400]],
  ["stereotools=sbal=-0.5", [12000, 6000, -8000, 250, 0, -3000, 1600, 400]],
  ["stereotools=mlev=1/2", [8000, 0, -6750, 4250, 1000, -3000, 1200, -400]],
  ["stereotools=mlev=0.015625", [4125, -3875, -5539, 5461, 1969, -2031, 812, -788]],
  ["stereotools=mlev=64", [32767, 32767, -32768, -32768, -32768, -32768, 32767, 32767]],
  ["stereotools=slev=0.015625", [8062, 7938, -2586, -2414, -1969, -2031, 812, 788]],
  ["stereotools=slev=64", [32767, -32768, -32768, 32767, 32767, -32768, 32767, -32768]],
  ["stereotools=mpan=-1", [12000, -4000, -8000, 5500, 0, -2000, 1600, -800]],
  ["stereotools=mpan=0", [12000, 4000, -8000, 3000, 0, -4000, 1600, 0]],
  ["stereotools=mpan=1", [4000, 4000, -5500, 3000, 2000, -4000, 800, 0]],
  ["stereotools=sbal=-1", [12000, 8000, -8000, -2500, 0, -2000, 1600, 800]],
  ["stereotools=sbal=0", [12000, 4000, -8000, 3000, 0, -4000, 1600, 0]],
  ["stereotools=sbal=1", [8000, 4000, -2500, 3000, -2000, -4000, 800, 0]],
  ["stereotools=mode=0:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [4500, 1000, -1938, 750, -750, -1000, 500, 0]],
  ["stereotools=mode=1:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [2500, 250, -250, -875, -1000, 500, 200, 100]],
  ["stereotools=mode=2:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [6500, 2000, -3625, -2750, -500, 1000, 800, 400]],
  ["stereotools=mode=3:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [12000, 12000, -8000, -8000, 0, 0, 1600, 1600]],
  ["stereotools=mode=4:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [4000, 4000, 3000, 3000, -4000, -4000, 0, 0]],
  ["stereotools=mode=5:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [8000, 8000, -2500, -2500, -2000, -2000, 800, 800]],
  ["stereotools=mode=6:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [3500, 3000, -562, -2000, -1250, 0, 300, 400]],
  ["stereotools=mode=7:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [6500, 6500, -3625, -3625, -500, -500, 800, 800]],
  ["stereotools=mode=8:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [2000, 2000, -2750, -2750, 1000, 1000, 400, 400]],
  ["stereotools=mode=9:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [2000, 6500, -2750, -3625, 1000, -500, 400, 800]],
  ["stereotools=mode=10:mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5", [4000, 4000, -5500, -5500, 2000, 2000, 800, 800]],
  ["stereotools=mlev=0.5:slev=0.25:mpan=-0.5:sbal=0.5:level_in=2:level_out=0.5:phasel=1:delay=0.5", [-4500, 0, 1938, 0, 750, 1000, -500, 750]]
];
for (const key of ["mlev", "slev", "mpan", "sbal"]) {
  const invalid = key === "mlev" || key === "slev"
    ? ["0", "-1", "0.015624", "64.001"] : ["-1.001", "1.001"];
  for (const value of [...invalid, "", "NaN", "Infinity", "bad"]) {
    cases.push([`stereotools=${key}=${value}`, undefined]);
  }
}
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native mid/side PCM (${graph ? "graph" : "simple"}): ${filter}`, async () => {
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
        assert.notEqual(result.exitCode, 0);
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
