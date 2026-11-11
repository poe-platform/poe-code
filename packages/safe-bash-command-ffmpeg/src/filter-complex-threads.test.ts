import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const threads of [undefined, "1", "2"]) {
  for (const position of ["before input", "before graph"]) {
    it(`accepts filter_complex_threads=${threads ?? "omitted"} ${position} with native mapped stereo PCM`, async () => {
      const left = Float64Array.from({ length: 256 }, (_, i) => (i < 40 || i >= 160 ? 9000 : 0) / 32768);
      const right = Float64Array.from({ length: 256 }, (_, i) => (i >= 64 && i < 144 ? -7000 : 0) / 32768);
      const input = Buffer.from(encodeWav({ sampleRate: 8000, channels: [left, right] }));
      const volume = Volume.fromJSON({ "/in.wav": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const option = threads === undefined ? [] : ["-filter_complex_threads", threads];
      const result = await createFfmpegCommand().execute({
        args: ["-nostats", "-v", "info",
          ...(position === "before input" ? option : []), "-i", "in.wav",
          ...(position === "before graph" ? option : []),
          "-filter_complex", "[0:a]anull[out]", "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(stdout);
      assert.equal(pcm.length, 1024);
      // Native FFmpeg 7.0.2 output for this stereo fixture, with either thread count.
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "68ed83a02a093c6708de7784ab533ac9c489c33b4a1febc6d0491aaba0f4f8d2");
      assert.deepEqual(volume.readFileSync("/in.wav"), input);
      assert.deepEqual(volume.readdirSync("/"), ["in.wav"]);
    });
  }
}
