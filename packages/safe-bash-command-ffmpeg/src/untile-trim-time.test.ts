import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, seven 2x2 gray sheets at 6 fps, passthrough timestamps.
for (const graph of [false, true]) {
  for (const [filter, hex] of [
    ["untile=2x1,trim=start=0.4", "313140404141505051516060616170707171"],
    ["setpts=PTS+2,untile=2x1,trim=start=0.4:end=1.1", "1010111120202121303031314040414150505151"],
    ["untile=2x1,trim=start=0.5:end=1", "404041415050515160606161"],
    ["untile=2x1,trim=end=0.4", "10101111202021213030"],
    ["untile=2x1,trim=start_pts=5:end_pts=9", "3131404041415050"],
    ["untile=2x1,trim=start=0.4:duration=0.25", "313140404141"],
    ["setpts=PTS+2,untile=2x1,trim=start_pts=2:end_pts=7", "1010111120202121303031314040414150505151"],
    ["trim=start=0.4", "3031303140414041505150516061606170717071"]
  ] as const) {
    it(`matches native fractional time boundaries for ${filter} (graph=${graph})`, async () => {
      const input = Buffer.from(Array.from({ length: 7 }, (_, i) =>
        [0, 1, 0, 1].map(column => (i + 1) * 16 + column)).flat());
      const volume = Volume.fromJSON({ "/in.gray": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "fatal", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
          "-framerate", "6", "-i", "/in.gray",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough",
          "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
      assert.deepEqual(volume.readFileSync("/in.gray"), input);
    });
  }
}
