import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, signed PCM16 mono at 8 kHz.
const input = [-32768, -30000, -123, -2, -1, 0, 1, 2, 123, 30000, 32767, 10000];
const positive = [-24576, -21808, 8068, 8189, 8190, 8191, 8192, 8193, 8314, 27852, 27852, 18191];
const negative = [-27853, -27853, -8315, -8194, -8193, -8192, -8191, -8190, -8069, 21808, 24575, 1808];
const clipped = [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192];
const cases: [string, number[] | null][] = [
  ["dcshift=0.25:limitergain=0.1", positive],
  ["dcshift=0.25:0.1", positive],
  ["dcshift=shift=0.25:limitergain=0.1", positive],
  ["dcshift=-0.25:0.1", negative],
  ["dcshift=shift=-0.25:limitergain=0.1", negative],
  ["dcshift=shift=0.25:limitergain=0", clipped],
  ["dcshift=0.25", clipped],
  ["dcshift=-0.25", [-32768, -32768, -8315, -8194, -8193, -8192, -8191, -8190, -8069, 21808, 24575, 1808]],
  ["dcshift=limitergain=0.1", input],
  ["dcshift=0.25:limitergain=0.1:enable=0", input],
  ["dcshift=0.25:limitergain=0.1:enable=1", positive],
  ["dcshift=0.25:limitergain=-0.1", null],
  ["dcshift=0.25:limitergain=1.1", null],
  ["dcshift=0.25:limitergain=NaN", null],
  ["dcshift=0.25:limitergain=", null],
  ["dcshift=0.25:0.1:0.2", null]
];

for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`${filter} produces expected destination bytes (${graph ? "graph" : "simple"})`, async () => {
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
      if (expected === null) assert.notEqual(result.exitCode, 0, stderr);
      else assert.equal(result.exitCode, 0, stderr);
      const output = expected === null ? Buffer.from("KEEP") : Buffer.alloc(expected.length * 2);
      expected?.forEach((sample, i) => output.writeInt16LE(sample, i * 2));
      assert.deepEqual(volume.readFileSync("/out.raw"), output);
    });
  }
}
