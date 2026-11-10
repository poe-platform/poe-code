import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-32670, -31718, -32677, -30955, 30955, 32677, 31718, 32670];

for (const format of ["flt", "fltp", "dbl", "dblp", "s32", "s32p", "s16", "s16p", "u8", "u8p"]) {
  for (const key of ["f", "sample_fmts"]) {
    for (const graph of [false, true]) {
      it(`converts aformat ${key}=${format} through ${graph ? "filter_complex" : "af"}`, async () => {
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.raw", input);
        const filter = `aformat=${key}=${format}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
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
        assert.equal(result.exitCode, 0, stderr);
        const expected = Buffer.alloc(input.length);
        // Native FFmpeg 7.0.2: u8 discards the low eight bits of PCM16 input.
        const levels = (format === "u8" || format === "u8p")
          ? [-32768, -31744, -32768, -30976, 30720, 32512, 31488, 32512] : samples;
        levels.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      });
    }
  }
}
