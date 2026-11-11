import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  96 + 2 * Math.floor((i % 16) / 3) + Math.floor(Math.floor(i / 16) / 4)));

for (const [options, valid] of [
  ["", true],
  [":threads=1", true],
  [":thread_type=slice", true],
  [":extra_hw_frames=1", true],
  [":threads=1:thread_type=slice:extra_hw_frames=1", true],
  [":threads=0:thread_type=0:extra_hw_frames=-1", true],
  [":threads=1+1:thread_type=all-slice:extra_hw_frames=2-1", true],
  [":threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647", true],
  [":threads=-1", false],
  [":threads=2147483648", false],
  [":threads=bogus", false],
  [":thread_type=bogus", false],
  [":thread_type=0.5", false],
  [":thread_type=4294967296", false],
  [":extra_hw_frames=-2", false],
  [":extra_hw_frames=2147483648", false],
  [":extra_hw_frames=bogus", false],
  [":threads=1:unknown=1", false]
] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.raw"]) {
      it(`deband generic options ${options || "control"} (${graph ? "graph" : "simple"}, ${output})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const before = volume.toJSON();
        const chunks: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const filter = `deband=r=-3:d=-1:1thr=0.1${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo",
            "-pixel_format", "gray", "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        const stderr = Buffer.concat(errors).toString();
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          const bytes = output === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(output) as Buffer;
          // Native FFmpeg 7.0.2: all generic options preserve the complete filtered frame.
          assert.equal(bytes.length, 256);
          assert.equal(createHash("sha256").update(bytes).digest("hex"),
            "55f93c19c04617cdbb09c1d2d63e7dc728400a2a65ae0d967f5a4c500e6c6a41");
          assert.equal(bytes.filter((value, i) => value !== input[i]).length, 166);
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
          if (output === "pipe:1") assert.deepEqual(volume.toJSON(), before);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("deband:"), stderr);
          assert.equal(Buffer.concat(chunks).length, 0);
          assert.deepEqual(volume.toJSON(), before);
        }
      });
    }
  }
}
