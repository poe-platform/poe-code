import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -4000, 2000, -3000, 3000, -2000, 4000, -1000, 5000, 1000, 6000, 2000, 7000, 3000, 8000, 4000];
// PCM captured from native FFmpeg 9.0.1, matching the 7.0.2 delay behavior.
const cases: [number, string, readonly number[] | undefined][] = [
  [8000, "stereotools=delay=1", [1000, 0, 2000, 0, 3000, 0, 4000, 0, 5000, -4000, 6000, -3000, 7000, -2000, 8000, -1000]],
  [8000, "stereotools=delay=-1", [0, -4000, 0, -3000, 0, -2000, 0, -1000, 1000, 1000, 2000, 2000, 3000, 3000, 4000, 4000]],
  [8000, "stereotools=delay=0", [1000, -4000, 2000, -3000, 3000, -2000, 4000, -1000, 5000, 1000, 6000, 2000, 7000, 3000, 8000, 4000]],
  [8000, "stereotools=delay=0.1", [1000, -4000, 2000, -3000, 3000, -2000, 4000, -1000, 5000, 1000, 6000, 2000, 7000, 3000, 8000, 4000]],
  [8000, "stereotools=delay=0.49", [1000, 0, 2000, -4000, 3000, -3000, 4000, -2000, 5000, -1000, 6000, 1000, 7000, 2000, 8000, 3000]],
  [8000, "stereotools=delay=-0.49", [0, -4000, 1000, -3000, 2000, -2000, 3000, -1000, 4000, 1000, 5000, 2000, 6000, 3000, 7000, 4000]],
  [44100, "stereotools=delay=0.1", [1000, 0, 2000, 0, 3000, -4000, 4000, -3000, 5000, -2000, 6000, -1000, 7000, 1000, 8000, 2000]],
  [8000, "stereotools=delay=20", [1000, 0, 2000, 0, 3000, 0, 4000, 0, 5000, 0, 6000, 0, 7000, 0, 8000, 0]],
  [8000, "stereotools=delay=-20", [0, -4000, 0, -3000, 0, -2000, 0, -1000, 0, 1000, 0, 2000, 0, 3000, 0, 4000]],
  [8000, "stereotools=delay=1/2", [1000, 0, 2000, 0, 3000, -4000, 4000, -3000, 5000, -2000, 6000, -1000, 7000, 1000, 8000, 2000]],
  [8000, "stereotools=delay=0.5:mode=lr>rl:level_in=2:level_out=0.5:phasel=1", [4000, 0, 3000, 0, 2000, 1000, 1000, 2000, -1000, 3000, -2000, 4000, -3000, 5000, -4000, 6000]],
  [8000, "stereotools=delay=-0.5:mode=lr>ms:muter=1:phasel=1", [0, 0, 0, 0, 1500, 0, 500, 0, -500, 0, -1500, 0, -3000, 0, -4000, 0]]
];
for (const value of ["21", "-21", "20.001", "-20.001", "NaN", "Infinity", "bad", ""]) {
  cases.push([8000, `stereotools=delay=${value}`, undefined]);
}
for (const [rate, filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native stereo delay PCM (${graph ? "graph" : "simple"}): ${filter} at ${rate} Hz`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", "2", "-i", "/in.raw",
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
