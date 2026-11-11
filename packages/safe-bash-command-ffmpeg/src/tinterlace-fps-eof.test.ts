import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Byte-for-byte frame sequences verified with native FFmpeg 7.0.2.
for (const [count, filter, luma] of [
  [10, "tinterlace=mode=drop_odd,fps=10", [32, 32, 64, 64, 96, 96, 128, 128, 160]],
  [10, "tinterlace=mode=drop_odd", [32, 64, 96, 128, 160]],
  [10, "tinterlace=mode=drop_even,fps=10", [16, 16, 48, 48, 80, 80, 112, 112, 144, 144]],
  [9, "tinterlace=drop_odd,fps=10", [32, 32, 64, 64, 96, 96, 128, 128]],
  [9, "tinterlace=drop_even,fps=10", [16, 16, 48, 48, 80, 80, 112, 112, 112]],
  [2, "tinterlace=2,fps=10", [32]],
  [2, "tinterlace=1,fps=10", [16, 16]],
  [1, "tinterlace=drop_odd,fps=10", []],
  [1, "tinterlace=drop_even,fps=10", []],
  [10, "select=lt(n\\,6),tinterlace=drop_odd,fps=10", [32, 32, 64, 64, 96, 96, 96, 96, 96]],
  [10, "trim=end_frame=6,tinterlace=drop_odd,fps=10", [32, 32, 64, 64, 96]],
  [10, "setpts=PTS+10,tinterlace=drop_odd,fps=10", [32, 32, 64, 64, 96, 96, 128, 128, 160]]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves EOF for ${count} frames through ${filter} (graph=${graph})`, async () => {
      const frames = Array.from({ length: 10 }, (_, index) => Buffer.concat([
        Buffer.alloc(32 * 32, (index + 1) * 16), Buffer.alloc(32 * 32 / 2, 128)
      ]));
      const input = Buffer.concat(frames.slice(0, count));
      const volume = Volume.fromJSON({ "/in.yuv": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "yuv420p",
          "-video_size", "32x32", "-framerate", "10", "-i", "/in.yuv",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), Buffer.concat(luma.map(value => frames[value / 16 - 1]!)));
      assert.deepEqual(volume.readFileSync("/in.yuv"), input);
    });
  }
}
