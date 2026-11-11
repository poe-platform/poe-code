import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Captured with native FFmpeg 7.0.2. s32 overflow becomes INT32_MIN,
// whereas s16 wraps; neither conversion applies after negotiating doubles.
for (const format of ["s32le", "s16le"] as const) {
  for (const noise of [0.5, 1, 2, 3]) {
    for (const sign of [1, -1]) {
      for (const prefix of ["", "anull,", "aformat=sample_fmts=dbl,"]) {
        for (const graph of [false, true]) {
          it(`silencedetect matches ${format} n=${noise} (sign=${sign}, prefix=${prefix}, graph=${graph})`, async () => {
            const samples = format === "s32le"
              ? [1073741822, 1073741823, 1073741824, 0, 1, 2147483647]
              : [16382, 16383, 16384, 0, 1, 32767];
            const input = Buffer.alloc(samples.length * (format === "s32le" ? 4 : 2));
            samples.forEach((sample, index) => {
              if (format === "s32le") input.writeInt32LE(sign * sample, index * 4);
              else input.writeInt16LE(sign * sample, index * 2);
            });
            const fs = Volume.fromJSON({ "/in.raw": input });
            const filter = `${prefix}silencedetect=n=${noise}:d=0.000125`;
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args: ["-y", "-v", "info", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
                ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
                "-f", format, "/out.raw"],
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
            assert.deepEqual(fs.readFileSync("/in.raw"), input);
            assert.deepEqual(fs.readFileSync("/out.raw"), input);
            const floatingPoint = prefix === "aformat=sample_fmts=dbl,";
            const expected = noise === 0.5 ? [
              "silence_start: 0",
              floatingPoint ? "silence_end: 0.00025 | silence_duration: 0.00025"
                : "silence_end: 0.000125 | silence_duration: 0.000125",
              "silence_start: 0.000375",
              "silence_end: 0.000625 | silence_duration: 0.00025"
            ] : floatingPoint ? [
              "silence_start: 0",
              "silence_end: 0.00075 | silence_duration: 0.00075"
            ] : noise === 1 || format === "s16le" && noise === 3 ? [
              "silence_start: 0",
              "silence_end: 0.000625 | silence_duration: 0.000625"
            ] : [];
            assert.deepEqual(stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line).filter(line => line.includes("silence_")), expected);
          });
        }
      }
    }
  }
}
