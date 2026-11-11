import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [6000, -2000, 3000, 7000, -12000, 4000, 8000, 12000];
// Captured from native FFmpeg 7.0.2 with stereo s16le input/output at 8000 Hz.
const cases: [string, readonly number[] | undefined][] = [
  ["stereotools", samples],
  ["stereotools=level_in=2", [12000, -4000, 6000, 14000, -24000, 8000, 16000, 24000]],
  ["stereotools=level_out=0.5", [3000, -1000, 1500, 3500, -6000, 2000, 4000, 6000]],
  ["stereotools=level_in=2:level_out=0.5", samples],
  ["stereotools=level_in=64:level_out=0.015625", samples],
  ["stereotools=level_in=0.015625:level_out=64", samples],
  ["stereotools=level_in=1/2", [3000, -1000, 1500, 3500, -6000, 2000, 4000, 6000]],
  ["stereotools=level_in=0.015625", [94, -31, 47, 109, -188, 62, 125, 188]],
  ["stereotools=level_out=64", [32767, -32768, 32767, 32767, -32768, 32767, 32767, 32767]],
  ["stereotools=level_in=2:level_out=0.5:mode=lr>ms:phasel=1", [-2000, 4000, -5000, -2000, 4000, -8000, -10000, -2000]]
];
for (const key of ["level_in", "level_out"]) {
  for (const value of ["", "0", "-1", "0.015624", "64.001", "NaN", "Infinity", "bad"]) {
    cases.push([`stereotools=${key}=${value}`, undefined]);
  }
}
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native stereo gain PCM (${graph ? "graph" : "simple"}): ${filter}`, async () => {
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
