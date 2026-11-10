import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: alternating +12000/-12000 mono PCM16 samples at 8 kHz.
const expected = [0, 0, 0, -1500, 3000, -4500, 6000, -7500, 9000, -10500,
  12000, -12000, 12000, -12000, 12000, -12000];
for (const [options, valid] of [
  ["t=in:ss=2:ns=8", true],
  ["t=in:ss=2:ns=8:", true],
  ["type=in:start_sample=2:nb_samples=8:", true],
  ["in:2:8:", true],
  ["t=in:ss=2:ns=8::", false],
  ["in::8:", false],
  ["t=in:ss=2:ns=:", false],
  ["t=in:ss=2:ns=8:''", true]
] as const) {
  for (const graph of [false, true]) {
    it(`afade=${options} handles separators (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(32);
      for (let i = 0; i < 16; i++) input.writeInt16LE(i % 2 ? -12000 : 12000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, ...(!valid ? { "/out.raw": "KEEP" } : {}) });
      const errors: Uint8Array[] = [];
      const filter = `afade=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, expected.length * 2);
        assert.deepEqual(expected.map((_, i) => output.readInt16LE(i * 2)), expected);
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
    });
  }
}
