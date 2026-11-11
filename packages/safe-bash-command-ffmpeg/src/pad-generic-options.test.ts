import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 pads these four gray samples to 0d1400001b220000.
for (const [options, exitCode] of [
  ["", 0],
  [":threads=1", 0],
  [":thread_type=slice", 0],
  [":extra_hw_frames=1", 0],
  [":threads=1:thread_type=slice:extra_hw_frames=1", 0],
  [":threads=0:thread_type=0:extra_hw_frames=-1", 0],
  [":threads=1+1:extra_hw_frames=2-1", 0],
  [":threads=2147483647:extra_hw_frames=2147483647", 0],
  [":thread_type=-1", 0],
  [":thread_type=4294967295", 0],
  [":threads=-1", 222],
  [":threads=2147483648", 222],
  [":extra_hw_frames=-2", 222],
  [":extra_hw_frames=2147483648", 222],
  [":thread_type=0.5", 222],
  [":thread_type=4294967296", 222],
  [":threads=bogus", 234],
  [":thread_type=bogus", 234],
  [":extra_hw_frames=bogus", 234],
  [":no_such_opt=1", 8],
  [":threads=1:no_such_opt=1", 8]
] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.raw"]) {
      it(`pad generic options ${options || "(defaults)"} (${graph ? "graph" : "simple"}, ${output})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from([13, 20, 27, 34]), "/out.raw": "KEEP" });
        const before = volume.toJSON();
        const chunks: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const filter = `pad=4:2${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-pix_fmt", "gray", "-f", "rawvideo", output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        const stderr = Buffer.concat(errors).toString();
        assert.equal(result.exitCode, exitCode, stderr);
        if (exitCode === 0) {
          assert.equal(stderr, "");
          const bytes = output === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(output) as Buffer;
          assert.equal(bytes.toString("hex"), "0d1400001b220000");
          assert.deepEqual(volume.readFileSync("/in.raw"), Buffer.from([13, 20, 27, 34]));
          if (output === "pipe:1") assert.deepEqual(volume.toJSON(), before);
        } else {
          assert.deepEqual(volume.toJSON(), before);
          assert.equal(Buffer.concat(chunks).length, 0);
          assert.ok(stderr.includes(exitCode === 8 ? "pad: unsupported option no_such_opt" : "pad:"), stderr);
        }
      });
    }
  }
}
