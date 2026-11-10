import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2 statuses and output bytes for three 4x4 RGBA frames.
for (const [filter, exitCode] of [
  ["crop=bad=1", 8],
  ["crop=2:2:1:1:0:2", 234],
  ["crop=2:2:keep_aspect=bogus", 234],
  ["crop=2:2:exact=bogus", 234],
  ["crop=2:2:enable=0", 176],
  ["crop=2:2:enable=1", 176],
  ["crop=2:2:1:1", 0]
] as const) {
  for (const existing of [false, true]) {
    it(`${filter} returns ${exitCode} with ${existing ? "existing" : "absent"} output`, async () => {
      const input = Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat());
      const volume = Volume.fromJSON({ "/in.raw": input, ...(existing ? { "/out.raw": "KEEP" } : {}) });
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const argumentValues = createCommandArguments([
        "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"
      ]);
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
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
      if (exitCode !== 0) {
        assert.deepEqual(volume.toJSON(), before);
        assert.ok(stderr.includes("crop:"), stderr);
      } else {
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
          "1525458516264686192949891a2a4a8a2535559526365696293959992a3a5a9a354565a5364666a6394969a93a4a6aaa");
      }
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
