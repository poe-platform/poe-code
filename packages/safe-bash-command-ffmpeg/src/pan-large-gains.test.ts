import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 200, 400, 600, -800, 1200, 1600, -2000, 1, 2, 3, 4, -1, 6, -3, 8, 32767, 10, -32768, 12];
// Native FFmpeg 7.0.2 output, identical with default CPU flags and -cpuflags 0.
for (const [expression, expected] of [
  ["mono|c0=32*c0", [32000, 12800, -25600, 32767, 32, 96, -32, -96, -32, 0]],
  ["mono|c0=128*c0", [-3072, 32767, 28672, -32768, 128, 384, -128, -384, -128, 0]],
  ["mono|c0=65535*c0", [-1000, -400, 800, -1600, 32767, 32767, -32768, -32768, 32767, 32767]],
  ["mono|c0=65536*c0", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0=65537*c0", [1000, 400, -800, 1600, -32768, -32768, 32767, 32767, -32768, -32768]],
  ["mono|c0=-128*c0", [3072, -32768, -28672, 32767, -128, -384, 128, 384, 128, 0]],
  ["mono|c0=-65535*c0", [1000, 400, -800, 1600, -32768, -32768, 32767, 32767, -32768, -32768]],
  ["mono|c0=-65536*c0", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0=-65537*c0", [-1000, -400, 800, -1600, 32767, 32767, -32768, -32768, 32767, 32767]],
  ["mono|c0=65537*c0+c1", [1200, 1000, 400, -400, 3, 7, 5, 5, -32759, -32756]],
  ["mono|c0=65537*c1", [200, 600, 1200, -2000, 2, 4, 6, 8, 10, 12]],
  ["mono|c0=128*c0+128*c1", [22528, -3072, 32767, -32768, 384, 896, 640, 640, 1152, 1536]],
  ["mono|c0=1e30*c0", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0=1e300*c0", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["mono|c0=65535.5*c0", [-500, -200, 400, -800, -32768, 32767, -32768, -32768, 32767, 16384]],
  ["mono|c0=32768*c0+32768*c1", [0, 0, 0, 0, -32768, -32768, -32768, -32768, -32768, 0]],
  ["mono|c0=32768*c0", [0, 0, 0, 0, 32767, -32768, -32768, 32767, -32768, 0]],
  ["mono|c0=65537*c0+65537*c1", [1200, 1000, 400, -400, 3, 7, 5, 5, -32759, -32756]]
] as const) {
  for (const format of ["s16le", "s16be"] as const) {
    for (const complex of [false, true]) {
      it(`matches native large pan gains (${format}, ${complex ? "graph" : "simple"}): ${expression}`, async () => {
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => {
          if (format === "s16be") input.writeInt16BE(sample, index * 2);
          else input.writeInt16LE(sample, index * 2);
        });
        const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
        fs.writeFileSync("/in.raw", input);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"] : ["-af", `pan=${expression}`]),
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
        assert.equal(result.exitCode, 0, stderr);
        const expectedBytes = Buffer.alloc(expected.length * 2);
        expected.forEach((sample, index) => expectedBytes.writeInt16LE(sample, index * 2));
        assert.deepEqual(fs.readFileSync("/out.raw"), expectedBytes);
        assert.deepEqual(fs.readFileSync("/in.raw"), input);
      });
    }
  }
}
