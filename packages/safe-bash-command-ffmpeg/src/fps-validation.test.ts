import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 statuses and bytes for six one-byte gray frames at 5 fps.
for (const [filter, exitCode, expected] of [
  ["fps=3:enable=1", 176, Buffer.from("KEEP")],
  ["fps=5:eof_action=2", 222, Buffer.from("KEEP")],
  ["fps=5:bogus=1", 8, Buffer.from("KEEP")],
  ["fps=5:round=bogus", 234, Buffer.from("KEEP")],
  ["fps=3:round=5", 0, Buffer.from([20, 60, 100, 120])]
] as const) {
  it(`${filter} returns status ${exitCode} and exact destination bytes`, async () => {
    const source = Buffer.from([20, 40, 60, 80, 100, 120]);
    const volume = Volume.fromJSON({ "/in.gray": source, "/out": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "1x1", "-framerate", "5", "-i", "/in.gray", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.deepEqual(volume.readFileSync("/out"), expected);
    assert.deepEqual(volume.readFileSync("/in.gray"), source);
    assert.equal(result.exitCode, exitCode, Buffer.concat(errors).toString());
  });
}
