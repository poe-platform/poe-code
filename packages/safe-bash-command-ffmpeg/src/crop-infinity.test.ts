import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgba", "gray16be", "rgb48be", "rgba64be", "yuv444p"]) {
  for (const [position, x, y] of [
    ["1/0:1", 2, 1], ["-1/0:1", 0, 1],
    ["1:1/0", 1, 2], ["1:-1/0", 1, 0],
    ["1/0:1/0", 2, 2], ["2:0", 2, 0], ["0:0", 0, 0]
  ] as const) {
    it(`clamps crop ${position} to (${x}, ${y}) for three ${format} frames`, async () => {
      const planes = format === "yuv444p" ? 3 : 1;
      const stride = { rgba: 4, gray16be: 2, rgb48be: 6, rgba64be: 8, yuv444p: 1 }[format]!;
      const input = Buffer.alloc(3 * 16 * planes * stride);
      const expected: number[] = [];
      for (let frame = 0; frame < 3; frame++) {
        for (let plane = 0; plane < planes; plane++) {
          for (let pixel = 0; pixel < 16; pixel++) {
            const offset = ((frame * planes + plane) * 16 + pixel) * stride;
            for (let byte = 0; byte < stride; byte++) {
              input[offset + byte] = 16 + frame * 16 + plane * 64 + pixel + byte * 20;
            }
            if (pixel % 4 >= x && pixel % 4 < x + 2 && Math.floor(pixel / 4) >= y && Math.floor(pixel / 4) < y + 2) {
              expected.push(...input.subarray(offset, offset + stride));
            }
          }
        }
      }
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.raw", input);
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
          "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw",
          "-vf", `crop=2:2:${position}`, "-fps_mode", "passthrough",
          "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected));
    });
  }
}
