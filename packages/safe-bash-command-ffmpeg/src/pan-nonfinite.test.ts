import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 400, -800, 1600];
const silence = [0, 0, 0, 0];
// Native FFmpeg 7.0.2: PCM16 coefficients become zero; float paths retain nonfinite samples.
for (const [format, expression, expected] of [
  ["s16le", "c0=nan*c0", silence], ["s16le", "c0=inf*c0", silence],
  ["s16le", "c0=1e999*c0", silence], ["s16le", "c0=NaN*c0", silence],
  ["s16le", "c0=INF*c0", silence], ["s16le", "c0=Infinity*c0", silence],
  ["s16le", "c0=-inf*c0", silence], ["s16le", "c0=-nan*c0", silence],
  ["s16le", "c0=-1e999*c0", silence],
  ["s16le", "c0=0*c0", silence], ["s16le", "c0=1*c0", left],
  ["s16le", "c0=nan*c0+c1", silence], ["s16le", "c0=c0+nan*c1", left],
  ["s16le", "c0=inf*c0+c1", silence], ["s16le", "c0=c0+inf*c1", left],
  ["s16le", "c0<inf*c0+c1", silence], ["s16le", "c0<nan*c0+c1", silence],
  ["s16le", "c0=nanx*c0", null], ["s16le", "c0=nan2*c0", null], ["s16le", "c0=infinite*c0", null],
  ["s16le", "c0=1e+*c0", null], ["s16le", "c0=.*c0", null],
  ["f32le", "c0=nan*c0", [NaN, NaN, NaN, NaN]],
  ["f32le", "c0=inf*c0", [Infinity, Infinity, -Infinity, Infinity]],
  ["f32le", "c0=1e999*c0", [Infinity, Infinity, -Infinity, Infinity]]
] as const) {
  for (const complex of [false, true]) {
    it(`handles nonfinite pan gains (${format}, ${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const width = format === "s16le" ? 2 : 4;
      const input = Buffer.alloc(8 * width);
      [1000, 200, 400, 600, -800, 1200, 1600, -2000].forEach((sample, i) => {
        if (format === "s16le") input.writeInt16LE(sample, i * width);
        else input.writeFloatLE(sample / 32768, i * width);
      });
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `pan=mono|${expression}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", format, "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", format, "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.equal(result.exitCode, 234);
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, expected.length * width);
        assert.deepEqual(expected.map((_, i) => format === "s16le" ? output.readInt16LE(i * width) : output.readFloatLE(i * width)), expected);
      }
    });
  }
}
