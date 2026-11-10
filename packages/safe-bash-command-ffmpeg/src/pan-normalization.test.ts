import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Eight stereo PCM16 frames, including rounding ties and near-full-scale samples.
const samples = [1, 80, 3, 160, 5, 240, 7, 320, -1, -400, -3, -480, 30001, 555, -31001, -630];
for (const [expression, expected] of [
  ["mono|c0<0.000009*c0", [0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0<0.00001*c0", [1, 3, 5, 7, -1, -3, 30001, -31001]],
  ["mono|c0<0.000011*c0", [1, 3, 5, 7, -1, -3, 30001, -31001]],
  ["mono|c0=0.00001*c0", [0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0<2*c0+-1*c1", [-26, -51, -77, -102, 133, 158, 19815, -20457]],
  ["mono|c0<-1*c0+-1*c1", [-40, -81, -122, -163, 201, 242, -15278, 15816]],
  ["mono|c0<c0+-1*c1", [-39, -78, -117, -156, 200, 239, 14723, -15185]],
  ["mono|c0<0*c0+0*c1", [0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0=c0+-1*c1", [-79, -157, -235, -313, 399, 477, 29446, -30371]]
] as const) {
  for (const complex of [false, true]) {
    it(`preserves pan gain magnitude and polarity (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      volume.writeFileSync("/lr.raw", input);
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
        : ["-af", `pan=${expression}`];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/lr.raw",
          ...filters, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: expected.length }, (_, index) => output.readInt16LE(index * 2)), expected);
      assert.deepEqual(volume.readFileSync("/lr.raw"), input);
    });
  }
}
