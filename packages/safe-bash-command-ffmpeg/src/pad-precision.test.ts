import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgb48be", "rgba64be", "rgba"] as const) {
  const channels = format === "rgb48be" ? 3 : 4;
  const sampleBytes = format === "rgba" ? 1 : 2;
  const stride = channels * sampleBytes;
  const input = Buffer.alloc(4 * stride);
  for (let pixel = 0; pixel < 4; pixel++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = [0x1234, 0x4567, 0x89ab, 0x3456][channel]! + pixel;
      if (sampleBytes === 2) input.writeUInt16BE(sample, pixel * stride + channel * 2);
      else input[pixel * stride + channel] = sample & 255;
    }
  }
  const border = Buffer.from(format === "rgb48be" ? "121234345656"
    : format === "rgba64be" ? "1212343456568080" : "12345680", "hex");
  const padded = Buffer.concat([
    border, border, border, border,
    border, input.subarray(0, 2 * stride), border,
    border, input.subarray(2 * stride), border,
    border, border, border, border
  ]);
  for (const [filter, expected] of [
    ["null", input],
    ["pad=iw:ih", input],
    ["pad=4:4:1:1,crop=2:2:1:1", input],
    ["pad=iw+4:ih+2:2:1,crop=iw-4:ih-2:2:1", input],
    ["pad=4:4:1:1:0x12345680", padded],
    ["crop=1:1:1:1", input.subarray(3 * stride)]
  ] as const) {
    it(`preserves exact ${format} samples through ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
          "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
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
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}
