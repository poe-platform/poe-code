import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Three 4x3 gray frames at 2 fps; FFmpeg 7.0.2 crops to these twelve bytes.
for (const [options, exitCode] of [
  ["", 0],
  [":threads=1", 0],
  [":thread_type=slice", 0],
  [":extra_hw_frames=1", 0],
  [":threads=0:thread_type=0:extra_hw_frames=-1", 0],
  [":threads=1+1:thread_type=slice:extra_hw_frames=0", 0],
  [":threads=-1", 222],
  [":threads=2147483648", 222],
  [":extra_hw_frames=-2", 222],
  [":thread_type=0.5", 222],
  [":threads=bogus", 234],
  [":thread_type=bogus", 234],
  [":extra_hw_frames=bogus", 234],
  [":threads=nan", 234],
  [":thread_type=-1", 0]
] as const) {
  for (const existing of [false, true]) {
    it(`crop generic options ${options || "(defaults)"} return ${exitCode} with ${existing ? "existing" : "absent"} output`, async () => {
      const input = Buffer.from(Array.from({ length: 36 }, (_, index) => index));
      const volume = Volume.fromJSON({ "/in.raw": input, ...(existing ? { "/out.raw": "KEEP" } : {}) });
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "4x3", "-framerate", "2", "-i", "/in.raw",
          "-vf", `crop=2:2:1:1${options}`, "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode === 0) {
        assert.equal(stderr, "");
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "0506090a111215161d1e2122");
      } else {
        assert.deepEqual(volume.toJSON(), before);
        assert.ok(stderr.includes("crop:"), stderr);
      }
    });
  }
}
