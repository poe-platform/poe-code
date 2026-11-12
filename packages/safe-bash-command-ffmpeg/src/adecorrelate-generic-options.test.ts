import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({
  sampleRate: 8000,
  channels: [0, 1].map(channel => Float64Array.from({ length: 64 }, (_, i) =>
    (((i * 2 + channel) * 1751) % 45001 - 22000) / 32768))
});

for (const graph of [false, true]) {
  for (const [option, exitCode] of [
    ["", 0], ["thread_type=slice", 0], ["extra_hw_frames=1", 0],
    ["threads=1", 0], ["threads=2", 0],
    ["threads=1:thread_type=slice:extra_hw_frames=1", 0],
    ["thread_type=none:extra_hw_frames=-1", 0],
    ["thread_type=all-slice:extra_hw_frames=default", 0],
    ["thread_type=4294967295:extra_hw_frames=2147483647", 0],
    ["thread_type=bogus", 234], ["thread_type=0.5", 222],
    ["thread_type=4294967296", 222], ["extra_hw_frames=-2", 222],
    ["extra_hw_frames=2147483648", 222], ["extra_hw_frames=bogus", 234],
    ["unknown=1", 8]
  ] as const) {
    it(`adecorrelate ${option || "defaults"} matches native status and PCM (graph=${graph})`, async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        const fs = createMemoryFileSystem();
        await fs.writeFile("/in.wav", input);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const filter = `adecorrelate@d=stages=2:seed=42${option ? `:${option}` : ""}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        assert.equal(result.exitCode, exitCode, stderr);
        const bytes = Buffer.concat(chunks);
        if (exitCode === 0) {
          assert.equal(stderr, "");
          assert.equal(bytes.length, 256);
          // Native FFmpeg 7.0.2 SHA-256 covers every interleaved PCM16 sample.
          assert.equal(createHash("sha256").update(bytes).digest("hex"),
            "bcf229bcfeb80f7449696a09184a62055134214758a983dbb3c06fd019e7a926");
        } else {
          assert.equal(bytes.length, 0);
          assert.ok(stderr.includes("adecorrelate"), stderr);
        }
        assert.deepEqual(await fs.readFile("/in.wav"), input);
      }
    });
  }
}
