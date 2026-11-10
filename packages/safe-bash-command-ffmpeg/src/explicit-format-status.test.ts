import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM64 WAV from the FFmpeg 7.0.2 reproduction; pcm_s64le is a codec, not a raw s64le format.
const samples = [17n, -17n, 2n ** 53n + 1n, -(2n ** 53n + 1n),
  2n ** 60n + 123n, -(2n ** 60n + 123n), 2n ** 63n - 1n, -(2n ** 63n)];
const wav = Buffer.alloc(44 + samples.length * 8);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(64000, 28);
wav.writeUInt16LE(8, 32);
wav.writeUInt16LE(64, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples.length * 8, 40);
samples.forEach((sample, index) => wav.writeBigInt64LE(sample, 44 + index * 8));

for (const [inputFormat, outputFormat] of [
  ["wav", "s64le"], ["wav", "unknown_muxer"],
  ["s64le", "wav"], ["unknown_demuxer", "wav"], ["wav", "s16le"]
] as const) {
  for (const existing of [false, true]) {
    it(`returns native status for ${inputFormat} to ${outputFormat} (existing=${existing})`, async () => {
      const volume = Volume.fromJSON(existing ? { "/out.raw": "KEEP" } : {});
      volume.writeFileSync("/in.raw", wav);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(existing ? ["-y"] : []), "-f", inputFormat, "-i", "/in.raw",
          "-c:a", "pcm_s16le", "-f", outputFormat, "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const valid = outputFormat === "s16le";
      assert.equal(result.exitCode, valid ? 0 : 234, stderr);
      assert.deepEqual(volume.readFileSync("/in.raw"), wav);
      assert.equal(volume.existsSync("/out.raw"), valid || existing);
      if (valid) {
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
          "0000ffff2000dfff0010ffefff7f0080");
      } else {
        assert.ok(stderr.includes(inputFormat === "wav"
          ? "Unable to find a suitable output format" : "Unknown input format"), stderr);
        if (existing) assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
    });
  }
}
