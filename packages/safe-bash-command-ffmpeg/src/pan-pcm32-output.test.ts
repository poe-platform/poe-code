import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1, 1073741824, 3, 5, -1, -3, -5, -1073741824, -2147483648];
// Native FFmpeg 7.0.2 PCM32 results, before conversion to the output format.
for (const [expression, expected] of [
  ["0.5*c0", [0, 536870912, 2, 2, 0, -2, -2, -536870912, -1073741824]],
  ["2*c0", [2, 2147483647, 6, 10, -2, -6, -10, -2147483648, -2147483648]],
  ["-0.25*c0", [0, -268435456, -1, -1, 0, 1, 1, 268435456, 536870912]],
  ["c0", samples]
] as const) {
  for (const format of ["f64le", "s32le"] as const) {
    for (const planar of [false, true]) {
      for (const complex of [false, true]) {
        it(`preserves PCM32 pan output (${format}, planar=${planar}, graph=${complex}): ${expression}`, async () => {
          const input = Buffer.alloc(samples.length * 8);
          samples.forEach((sample, index) => input.writeInt32LE(sample, index * 8));
          const fs = Volume.fromJSON({ "/in.raw": input });
          const filter = `${planar ? "aformat=sample_fmts=s32p," : ""}pan=mono|c0=${expression}`;
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-y", "-f", "s32le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
              ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", format, "/out.raw"],
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
          const bytes = Buffer.alloc(expected.length * (format === "f64le" ? 8 : 4));
          expected.forEach((sample, index) => {
            if (format === "f64le") bytes.writeDoubleLE(sample / 2147483648, index * 8);
            else bytes.writeInt32LE(sample, index * 4);
          });
          assert.deepEqual(fs.readFileSync("/out.raw"), bytes);
        });
      }
    }
  }
}
