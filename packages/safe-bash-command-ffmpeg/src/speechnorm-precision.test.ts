import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: float gain and multiplication put 750 * 1.17 just
// below the PCM16 halfway boundary; double precision lands exactly on it.
for (const double of [false, true]) for (const graph of [false, true]) {
  for (const [filter, pcm16, pcm64] of [
    ["anull", 750, 0.02288818359375],
    ["speechnorm=e=1.17", double ? 878 : 877, double ? 0.0267791748046875 : 0.02677917294204235],
    ["aformat=sample_fmts=s16,speechnorm=e=1.17", 877, 0.02677917294204235]
  ] as const) for (const format of ["s16le", "f64le"]) {
    it(`${filter} preserves native gain precision from ${double ? "float64" : "PCM16"} to ${format} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        new Float64Array([-750 / 32768, 750 / 32768])
      ] }, double ? { float: true, bitsPerSample: 64 } : {}));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", format, "/out.pcm"],
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
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, format === "s16le" ? 4 : 16);
      for (const [i, polarity] of [-1, 1].entries()) {
        assert.equal(format === "s16le" ? output.readInt16LE(i * 2) : output.readDoubleLE(i * 8),
          polarity * (format === "s16le" ? pcm16 : pcm64));
      }
    });
  }
}
