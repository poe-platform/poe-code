import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const source = [20, 40, 60, 80, 100, 120];
// Native FFmpeg preserves these bytes at the unchanged input rate.
for (const format of ["rawvideo", "image2"]) {
  for (const rate of ["24000/1001", "30000/1001"]) {
    for (const round of ["up", "down", "near", "zero", "inf"]) {
      it(`preserves exact ticks for ${format} ${rate} round=${round}`, async () => {
        const volume = Volume.fromJSON({ "/out": "KEEP" });
        volume.writeFileSync("/in.gray", Buffer.from(source));
        source.forEach((value, i) => volume.writeFileSync(`/in${i + 1}.png`, encodeImage({
          width: 1, height: 1, channels: 4, data: new Uint8Array([value, value, value, 255]),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data));
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", format,
            ...(format === "rawvideo" ? ["-pixel_format", "gray", "-video_size", "1x1"] : []),
            "-framerate", rate, "-i", format === "rawvideo" ? "/in.gray" : "/in%d.png",
            "-vf", `fps=source_fps:round=${round}`, "-fps_mode", "passthrough",
            "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
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
        assert.deepEqual(volume.readFileSync("/out"), Buffer.from(source));
      });
    }
  }
}
