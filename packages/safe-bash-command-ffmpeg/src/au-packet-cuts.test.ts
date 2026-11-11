import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// AU demuxer packet boundaries from ffprobe N-66595-gc2b38619c0-static.
for (const [sampleRate, channels, knownSize, packetBytes] of [
  [8000, 1, false, 640],
  [8000, 1, true, 640],
  [48000, 1, false, 2048],
  [8000, 2, false, 1280]
] as const) {
  for (const operation of ["copy", "frames", "duration", "seek", "encode"] as const) {
    it(`cuts AU ${sampleRate} Hz/${channels} ch, known size=${knownSize}, ${operation} at native boundaries`, async () => {
      const input = Buffer.alloc(16024);
      [0x2e736e64, 24, knownSize ? 16000 : 0xffffffff, 3, sampleRate, channels]
        .forEach((value, index) => input.writeUInt32BE(value, index * 4));
      for (let index = 0; index < 8000; index++) input.writeInt16BE(index, 24 + index * 2);
      const payload = input.subarray(24);
      const cutBytes = Math.ceil(sampleRate * 0.03 * channels * 2 / packetBytes) * packetBytes;
      const expected = operation === "seek" ? payload.subarray(cutBytes)
        : operation === "frames" ? payload.subarray(0, packetBytes)
        : operation === "duration" ? payload.subarray(0, cutBytes)
        : operation === "encode" ? payload.subarray(0, sampleRate * 0.03 * channels * 2) : payload;
      const cut = operation === "frames" ? ["-frames:a", "1"]
        : operation === "duration" || operation === "encode" ? ["-t", "0.03"]
        : operation === "seek" ? ["-ss", "0.03"] : [];
      const args = ["-v", "error", "-y", "-i", "/input.au", "-c:a",
        operation === "encode" ? "pcm_s16be" : "copy", ...cut, "-f", "s16be", "/output.bin"];
      const volume = Volume.fromJSON({ "/input.au": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((volume.readFileSync("/output.bin") as Buffer).equals(expected), true, "exact PCM payload");
      volume.unlinkSync("/output.bin");
      const syncResult = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      if (operation === "encode") {
        // Decoded PCM cuts defer to the async path for frame timestamp handling.
        assert.equal(syncResult, undefined);
        assert.equal(volume.existsSync("/output.bin"), false);
        return;
      }
      assert.equal(syncResult, "");
      assert.equal((volume.readFileSync("/output.bin") as Buffer).equals(expected), true, "exact PCM payload");
    });
  }
}
