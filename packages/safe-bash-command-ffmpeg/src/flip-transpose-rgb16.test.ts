import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg pixel orders for a 4x2 frame with pixels numbered 0 through 7.
const transforms = [
  ["null", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["hflip", [3, 2, 1, 0, 7, 6, 5, 4]],
  ["vflip", [4, 5, 6, 7, 0, 1, 2, 3]],
  ["transpose=cclock_flip", [0, 4, 1, 5, 2, 6, 3, 7]],
  ["transpose=clock", [4, 0, 5, 1, 6, 2, 7, 3]],
  ["transpose=cclock", [3, 7, 2, 6, 1, 5, 0, 4]],
  ["transpose=clock_flip", [7, 3, 6, 2, 5, 1, 4, 0]],
  ["transpose=clock,transpose=cclock", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["hflip,hflip,vflip,vflip", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["transpose=clock:landscape", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["hflip=enable=0,vflip=enable=0", [0, 1, 2, 3, 4, 5, 6, 7]]
] as const;

for (const [format, channels] of [["rgb48be", 3], ["rgba64be", 4], ["gray16be", 1], ["rgba", 4]] as const) {
  for (const [filter, order] of transforms) {
    it(`${filter} preserves every ${format} component across frames`, async () => {
      const bytesPerSample = format === "rgba" ? 1 : 2;
      const stride = channels * bytesPerSample;
      const input = Buffer.alloc(2 * 8 * stride);
      for (let pixel = 0; pixel < 16; pixel++) {
        for (let channel = 0; channel < channels; channel++) {
          const offset = pixel * stride + channel * bytesPerSample;
          if (bytesPerSample === 2) input.writeUInt16BE([0x1234, 0x4567, 0x89ab, 0xbdef][channel]! + pixel, offset);
          else input[offset] = [16, 32, 64, 128][channel]! + pixel;
        }
      }
      const expected = Buffer.concat([0, 8].flatMap(start => order.map(pixel =>
        input.subarray((start + pixel) * stride, (start + pixel + 1) * stride))));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const reads: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
          "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) {
            const bytes = volume.readFileSync(path) as Buffer;
            reads.push(bytes);
            return bytes;
          },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      assert.ok(reads.length > 0);
      for (const bytes of reads) assert.deepEqual(bytes, input, "input remains unchanged");
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
