import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const source = [20, 40, 60, 80, 100, 120];
// Exact rawvideo bytes from native FFmpeg 7.0.2, including the final frame interval.
for (const input of ["rawvideo", "image2"]) {
  for (const [filter, expected] of [
    ["setpts=2*PTS,fps=5", [20, 20, 40, 40, 60, 60, 80, 80, 100, 100, 120, 120]],
    ["setpts=2*PTS,fps=3:round=up", [20, 20, 40, 60, 80, 100, 120, 120]],
    ["setpts=2*PTS,fps=3", [20, 40, 60, 60, 80, 100, 120]],
    ["setpts=PTS,fps=5", source],
    ["setpts=2*PTS,null,fps=5", [20, 20, 40, 40, 60, 60, 80, 80, 100, 100, 120, 120]],
    ["setpts=2*PTS,setpts=PTS/2,fps=5", source],
    ["setpts=2*PTS,fps=3:round=up,fps=5", [20, 20, 20, 40, 40, 60, 60, 80, 100, 100, 120, 120, 120]]
  ] as const) {
    it(`${input} propagates the end timestamp through ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/out": "KEEP" });
      if (input === "rawvideo") volume.writeFileSync("/in.gray", Buffer.from(source));
      else source.forEach((value, index) => volume.writeFileSync(`/in${index + 1}.png`, encodeImage({
        width: 1, height: 1, channels: 4, data: new Uint8Array([value, value, value, 255]),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", input,
          ...(input === "rawvideo" ? ["-pixel_format", "gray", "-video_size", "1x1"] : []),
          "-framerate", "5", "-i", input === "rawvideo" ? "/in.gray" : "/in%d.png",
          "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(volume.readFileSync("/out"), Buffer.from(expected));
    });
  }
}
