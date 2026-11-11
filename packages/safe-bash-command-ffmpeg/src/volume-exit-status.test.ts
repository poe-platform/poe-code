import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
  [-30000, -16385, -3, -1, 1, 3, 16385, 30000], value => value / 32768
)] });

// FFmpeg 7.0.2-static on Linux: EINVAL (234), option not found (8), and half-gain PCM.
for (const [filter, exitCode] of [
  ["volume=50%", 234],
  ["volume=(1", 234],
  ["volume=nan", 234],
  ["volume=1:slice_threads=1", 8],
  ["volume=0.5", 0]
] as const) {
  for (const graph of [false, true]) {
    for (const destination of ["pipe:1", "/out.raw"]) {
      it(`${filter} returns ${exitCode} in a ${graph ? "complex" : "simple"} graph to ${destination}`, async () => {
        const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
        fs.writeFileSync("/in.wav", wav);
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", destination],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(p: string) { return fs.readFileSync(p); },
            async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
            async stat(p: string) { return fs.statSync(p); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(b: Uint8Array) { stdout.push(b); } },
          stderr: { async write(b: Uint8Array) { stderr.push(b); } }
        } as never);
        const error = Buffer.concat(stderr).toString();
        assert.equal(result.exitCode, exitCode, error);
        const expected = Buffer.from("68c500e0feff0000000002000020983a", "hex");
        assert.deepEqual(Buffer.concat(stdout), destination === "pipe:1" && exitCode === 0 ? expected : Buffer.alloc(0));
        assert.deepEqual(fs.readFileSync("/out.raw"), destination === "/out.raw" && exitCode === 0 ? expected : Buffer.from("KEEP"));
        if (exitCode === 0) assert.equal(error, "");
        else assert.ok(error.startsWith("ffmpeg: volume:"), error);
      });
    }
  }
}
