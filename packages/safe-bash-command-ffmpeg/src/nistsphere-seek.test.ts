import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: output copy seeks skip packets before -ss; input seeks
// start at the exact interleaved PCM frame, for both byte orders.
for (const [rate, channels, outputFrames] of [[8000, 1, 512], [8000, 2, 512], [48000, 1, 4096], [48000, 2, 4096]] as const) {
  for (const big of [false, true]) for (const inputSeek of [false, true]) {
    it(`seeks SPHERE PCM big=${big} ${rate} Hz/${channels} ch at ${inputSeek ? "input" : "output"}`, async () => {
      const bytes = Buffer.alloc(17024);
      bytes.write(`NIST_1A\n   1024\nchannel_count -i ${channels}\nsample_count -i ${8000 / channels}\nsample_rate -i ${rate}\nsample_n_bytes -i 2\nsample_byte_format -s2 ${big ? "10" : "01"}\nend_head\n`);
      for (let i = 0; i < 8000; i++) bytes[big ? "writeInt16BE" : "writeInt16LE"](i, 1024 + i * 2);
      const volume = Volume.fromJSON({ "/input": bytes, "/output": "keep" });
      const args = ["-v", "error", "-y", ...(inputSeek ? ["-ss", "0.03"] : []), "-i", "/input",
        ...(inputSeek ? [] : ["-ss", "0.03"]), "-c:a", "copy", "-f", big ? "s16be" : "s16le", "/output"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = bytes.subarray(1024 + (inputSeek ? rate * 0.03 : outputFrames) * channels * 2);
      assert.equal((volume.readFileSync("/output") as Buffer).equals(expected), true, "exact PCM bytes after seek");
      if (!inputSeek) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        assert.equal((volume.readFileSync("/output") as Buffer).equals(expected), true, "exact PCM bytes after seek");
      }
    });
  }
}
