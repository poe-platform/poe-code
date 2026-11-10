import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, mono signed PCM16 at 8 kHz, alternating +12000/-12000.
for (const [filter, expected] of [
  ["afade=ns=8:c=cbr", [0, -5999, 7559, -8653, 9524, -10259, 10902, -11477, 12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000]],
  ["afade=ns=8:c=9", [0, -5999, 7559, -8653, 9524, -10259, 10902, -11477, 12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000]],
  ["afade=ns=8:c=tri", [0, -1500, 3000, -4500, 6000, -7500, 9000, -10500, 12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000]],
  ["afade=t=out:ns=8:c=cbr", [12000, -11477, 10902, -10259, 9524, -8653, 7559, -5999, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["afade=ns=64:c=cbr", [0, -2999, 3779, -4326, 4762, -5129, 5451, -5738, 5999, -6240, 6463, -6671, 6868, -7054, 7230, -7398]],
  ["afade=ns=512:c=cbr", [0, -1499, 1889, -2163, 2381, -2564, 2725, -2869, 2999, -3120, 3231, -3335, 3434, -3527, 3615, -3699]]
] as const) {
  for (const graph of [false, true]) {
    for (const polarity of [1, -1]) it(`${filter} matches native PCM16 bytes (${graph ? "graph" : "simple"}, polarity ${polarity})`, async () => {
      const input = Buffer.alloc(32);
      const output = Buffer.alloc(32);
      for (let i = 0; i < 16; i++) {
        input.writeInt16LE((i % 2 ? -12000 : 12000) * polarity, i * 2);
        output.writeInt16LE(expected[i]! * polarity, i * 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": input });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-f", "s16le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(fs.readFileSync("/out.raw"), output);
    });
  }
}
