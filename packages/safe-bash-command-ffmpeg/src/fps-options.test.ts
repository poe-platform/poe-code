import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 output for six one-byte gray frames at 5 fps.
const source = [20, 40, 60, 80, 100, 120];
for (const [filter, exitCode, expected] of [
  ["fps=fps=3:round=up:5", 0, source],
  ["fps=round=up:fps=3:near", 234, []],
  ["fps=round=up:fps=3:5", 0, source],
  ["fps=fps=3:round=up:near", 234, []],
  ["fps=5:round=up", 0, source],
  ["fps=3:round=up", 0, [20, 40, 80, 120]],
  ["fps=fps=3:0:up", 0, [20, 40, 80, 120]]
] as const) {
  it(`matches native fps option resolution for ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.gray": Buffer.from(source), "/out": "KEEP" });
    let stderr = "";
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
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.deepEqual(volume.readFileSync("/out"), Buffer.from(expected));
    assert.deepEqual(volume.readFileSync("/in.gray"), Buffer.from(source));
    if (exitCode !== 0) assert.ok(stderr.includes("fps:"), stderr);
  });
}
