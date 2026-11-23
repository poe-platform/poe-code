import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// ffprobe N-66595-gc2b38619c0 reports 320 frames/packet at 8 kHz and
// 1024 at 48 kHz. Output stream-copy seeks discard packets before -ss;
// input seeks start at the exact interleaved PCM frame (FFmpeg 7.0.2).
for (const [rate, channels, outputFrames] of [[8000, 1, 320], [8000, 2, 320], [48000, 1, 2048], [48000, 2, 2048]] as const) {
  for (const inputSeek of [false, true]) {
    it(`seeks IRCAM PCM ${rate} Hz/${channels} ch at ${inputSeek ? "input" : "output"}`, async () => {
      const bytes = Buffer.alloc(17024);
      bytes.writeUInt32LE(0x0001a364); bytes.writeFloatLE(rate, 4);
      bytes.writeUInt32LE(channels, 8); bytes.writeUInt32LE(2, 12);
      for (let i = 0; i < 8000; i++) bytes.writeInt16LE(i, 1024 + i * 2);
      const volume = Volume.fromJSON({ "/input": bytes, "/output": "keep" });
      const args = ["-v", "error", "-y", ...(inputSeek ? ["-ss", "0.03"] : []), "-i", "/input",
        ...(inputSeek ? [] : ["-ss", "0.03"]), "-c:a", "copy", "-f", "s16le", "/output"];
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
