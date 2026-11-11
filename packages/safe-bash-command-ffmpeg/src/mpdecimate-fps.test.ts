import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [16, 32, 48, 64, 80, 96, 112, 112, 112, 112];
const frames = levels.map(level => Buffer.concat([
  Buffer.alloc(32 * 32, level), Buffer.alloc(32 * 32 / 2, 128)
]));
// Native FFmpeg 7.0.2 preserves input EOF independently of retained frame durations.
for (const [filter, count] of [
  ["mpdecimate,fps=10", 10],
  ["mpdecimate", 7],
  ["fps=10", 10],
  ["select=lt(n\\,8),mpdecimate,fps=10", 10],
  ["trim=end_frame=8,mpdecimate,fps=10", 8]
] as const) {
  it(`preserves trailing duplicate timing through ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.yuv": Buffer.concat(frames) });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "yuv420p",
        "-video_size", "32x32", "-framerate", "10", "-i", "/in.yuv", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { chunks.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(chunks), Buffer.concat(frames.slice(0, count)));
  });
}
