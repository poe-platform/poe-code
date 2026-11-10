import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, PCM16 mono at 8 kHz.
const input = [-32670, -31718, -32677, -30955, 30955, 32677, 31718, 32670];
const quantized = [-32768, -31744, -32768, -30976, 30720, 32512, 31488, 32512];
const cases: [string, number[] | null][] = [
  ["u8|s16", input],
  ["s16|u8", input],
  ["flt|s16", input],
  ["s16|flt", input],
  ["u8|flt", input],
  ["flt|u8", input],
  ["flt", input],
  ["s16", input],
  ["u8", quantized],
  ["s16|invalid", null],
  ["invalid|s16", null],
  ["u8||s16", null]
];

for (const [formats, expected] of cases) {
  for (const key of ["f=", "sample_fmts=", ""]) {
    for (const graph of [false, true]) {
      const filter = `aformat=${key}${formats}`;
      it(`negotiates ${filter} (${graph ? "graph" : "simple"})`, async () => {
        const bytes = Buffer.alloc(input.length * 2);
        input.forEach((sample, i) => bytes.writeInt16LE(sample, i * 2));
        const volume = Volume.fromJSON({ "/in.raw": bytes, "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
        const output = expected === null ? Buffer.from("KEEP") : Buffer.alloc(expected.length * 2);
        expected?.forEach((sample, i) => output.writeInt16LE(sample, i * 2));
        assert.deepEqual(volume.readFileSync("/out.raw"), output);
      });
    }
  }
}
