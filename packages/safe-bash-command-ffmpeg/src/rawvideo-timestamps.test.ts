import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const source = [20, 40, 60, 80, 100, 120];
// Native FFmpeg 7.0.2 reference bytes for six gray frames at 5 fps.
for (const [filter, expected] of [
  ["trim=start_pts=4", [100, 120]],
  ["trim=end_pts=3", [20, 40, 60]],
  ["setpts=PTS+5,fps=5:start_time=0", [20, 20, 20, 20, 20, 20, 40, 60, 80, 100, 120]],
  ["fps=3:start_time=0.1", [40, 80, 120, 120]],
  ["trim=start_frame=4", [100, 120]],
  ["fps=5,trim=start_pts=4", [100, 120]]
] as const) {
  for (const format of ["rawvideo", "image2"]) {
    it(`uses frame-rate ticks for ${format} with ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.gray": Buffer.from(source), "/out": "KEEP" });
      if (format === "image2") {
        source.forEach((value, i) => volume.writeFileSync(`/in${i + 1}.png`, encodeImage({
          width: 1, height: 1, channels: 4, data: new Uint8Array([value, value, value, 255]),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", format,
          ...(format === "rawvideo" ? ["-pixel_format", "gray", "-video_size", "1x1"] : []),
          "-framerate", "5", "-i", format === "rawvideo" ? "/in.gray" : "/in%d.png",
          "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out"), Buffer.from(expected));
    });
  }
}
