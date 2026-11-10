import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and output for the same RGBA input.
for (const [filter, exitCode, diagnostic] of [
  ["pad=eval=foo", 234, "pad:"],
  ["pad=4:4:color=bogus", 234, "Invalid color: bogus"],
  ["pad=oops=1", 8, "pad: unsupported option oops"],
  ["pad=4:4:eval=frame", 0, ""]
] as const) {
  it(`${filter} returns native status ${exitCode} and preserves output on error`, async () => {
    const input = Buffer.from([50, 30, 212, 255, 120, 180, 60, 128, 80, 140, 190, 64, 18, 47, 199, 0]);
    const volume = Volume.fromJSON({ "/in.rgba": input, "/o.raw": "KEEP" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2",
      "-framerate", "4", "-i", "/in.rgba", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "rgba", "-f", "rawvideo", "/o.raw"
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
      assert.ok(stderr.includes(diagnostic), stderr);
    } else {
      assert.equal((volume.readFileSync("/o.raw") as Buffer).toString("hex"),
        "321ed4ff78b43c80000000ff000000ff508cbe40122fc700000000ff000000ff000000ff000000ff000000ff000000ff000000ff000000ff000000ff000000ff");
      assert.deepEqual(volume.readFileSync("/in.rgba"), input);
    }
    assert.equal(result.exitCode, exitCode, stderr);
  });
}
