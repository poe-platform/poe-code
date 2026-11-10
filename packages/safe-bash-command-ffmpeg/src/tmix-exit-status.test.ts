import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2 statuses and output for the same YUV444 input.
for (const [filter, exitCode] of [
  ["tmix=frames=0", 222],
  ["tmix=frames=-1", 222],
  ["tmix=frames=1025", 222],
  ["tmix=frames=bad", 234],
  ["tmix=frames=", 234],
  ["tmix=frames=2:weights=bad", 234],
  ["tmix=bob=1", 8],
  ["tmix=frames=2", 0]
] as const) {
  it(`${filter} returns native status ${exitCode} and preserves output on error`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...[16, 17, 18, 30, 90, 235].flatMap(value => [
        Buffer.from("FRAME\n"), Buffer.alloc(4, value), Buffer.alloc(8, 128)
      ])
    ]);
    const volume = Volume.fromJSON({ "/gray.y4m": input, "/out.raw": "KEEP" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-i", "/gray.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"
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
      assert.ok(stderr.includes("tmix:"), stderr);
    } else {
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(
        [16, 17, 18, 24, 60, 163].map(value => Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]))
      ));
      assert.deepEqual(volume.readFileSync("/gray.y4m"), input);
    }
    assert.equal(result.exitCode, exitCode, stderr);
  });
}
