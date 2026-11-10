import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 samples for two-frame mixing of the gray Y4M input.
for (const [filter, expected] of [
  ["tmix=frames=2:weights=1 3 junk", [16, 17, 18, 27, 75, 199]],
  ["tmix=frames=2:weights=1 1 bad", [16, 17, 18, 24, 60, 163]],
  ["tmix=frames=2:weights=1 3", [16, 17, 18, 27, 75, 199]],
  ["tmix=frames=2", [16, 17, 18, 24, 60, 163]],
  ["tmix=frames=2:weights= 1  3  Infinity NaN", [16, 17, 18, 27, 75, 199]],
  ["tmix=1:1 junk", [16, 17, 18, 30, 90, 235]],
  ["tmix=frames=2:weights=1 junk 3", null],
  ["tmix=frames=3:weights=1 3 junk", null],
  ["tmix=frames=2:weights=1 Infinity", null]
] as const) {
  it(`tmix limits weight validation to its frame count: ${filter}`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...[16, 17, 18, 30, 90, 235].flatMap(value => [
        Buffer.from("FRAME\n"), Buffer.alloc(4, value), Buffer.alloc(8, 128)
      ])
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments(["-v", "error", "-y", "-i", "/in.y4m",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"]);
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
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("tmix: weights must be finite numbers"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.map(value =>
        Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]))));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    }
  });
}
