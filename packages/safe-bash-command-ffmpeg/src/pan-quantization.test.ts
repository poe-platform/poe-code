import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1, 3, 5, 7, -1, -3, 30001, -31001];
const right = [80, 160, 240, 320, -400, -480, 555, -630];
const integerHalf = [1, 2, 3, 4, 0, -1, 15001, -15500];
const floatHalf = [0, 2, 2, 4, 0, -2, 15000, -15500];
// Native FFmpeg 7.0.2 PCM16 output (also verified with -cpuflags 0).
for (const [format, filter, expected] of [
  ["s16le", "pan=mono|c0=0.5*c0", integerHalf],
  ["s16be", "pan=mono|c0=0.5*c0", integerHalf],
  ["s16le", "pan=mono|c0=0.6666666666666666*c0+0.3333333333333333*c1", [27, 55, 83, 111, -134, -162, 20185, -20877]],
  ["s16le", "pan=mono|c0=0.3*c0+0.3*c1", [24, 49, 74, 98, -120, -145, 9166, -9489]],
  ["s16le", "pan=mono|c0=0.0000152587890625*c0", [0, 0, 0, 0, 0, 0, 0, 0]],
  ["s16le", "pan=mono|c0=0.0000457763671875*c0", [0, 0, 0, 0, 0, 0, 2, -2]],
  ["s16le", "pan=mono|c0<2*c0+c1", [27, 55, 83, 111, -134, -162, 20185, -20877]],
  ["s16le", "pan=mono|c0=-0.5*c0", [0, -1, -2, -3, 1, 2, -15000, 15501]],
  ["s16le", "pan=mono|c0=2*c0", [2, 6, 10, 14, -2, -6, 32767, -32768]],
  ["s16le", "pan=stereo|c0=c0|c1=c1", left.flatMap((value, i) => [value, right[i]!])],
  ["s16le", "pan=stereo|c0=c1|c1=c0", right.flatMap((value, i) => [value, left[i]!])],
  ["s16le", "pan=mono|c0=0.5*c0,pan=mono|c0=0.5*c0", [1, 1, 2, 2, 0, 0, 7501, -7750]],
  ["s16le", "volume=1,pan=mono|c0=0.5*c0", floatHalf],
  ["s16le", "volume=1:precision=double,pan=mono|c0=0.5*c0", floatHalf],
  ["s16le", "volume=1:precision=fixed,pan=mono|c0=0.5*c0", integerHalf],
  ["s16le", "aeval=val(0)|val(1),pan=mono|c0=0.5*c0", floatHalf],
  ["s16le", "anull,pan=mono|c0=0.5*c0", integerHalf],
  ["f32le", "pan=mono|c0=0.5*c0", floatHalf],
  ["f32le", "pan=mono|c0=128*c0", [128, 384, 640, 896, -128, -384, 32767, -32768]],
  ["s16le", "volume=1,pan=mono|c0=65537*c0", [32767, 32767, 32767, 32767, -32768, -32768, 32767, -32768]],
  ["f32le", "pan=mono|c0=0.6666666666666666*c0+0.3333333333333333*c1", [27, 55, 83, 111, -134, -162, 20186, -20877]],
  ["s16le", "aformat=sample_fmts=s16p,pan=mono|c0=0.5*c0", integerHalf],
  ["s16le", "aformat=sample_fmts=s16p,pan=mono|c0=2*c0", [2, 6, 10, 14, -2, -6, 32767, -32768]],
  ["f32le", "aformat=sample_fmts=s16,pan=mono|c0=0.5*c0", integerHalf]
] as const) {
  for (const complex of [false, true]) {
    it(`matches native pan quantization (${format}, ${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const fs = Volume.fromJSON({ "/out.raw": "keep" });
      const bytes = Buffer.alloc(left.length * 2 * (format === "f32le" ? 4 : 2));
      left.flatMap((value, i) => [value, right[i]!]).forEach((value, i) => {
        if (format === "f32le") bytes.writeFloatLE(value / 32768, i * 4);
        else if (format === "s16be") bytes.writeInt16BE(value, i * 2);
        else bytes.writeInt16LE(value, i * 2);
      });
      fs.writeFileSync("/in.raw", bytes);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
