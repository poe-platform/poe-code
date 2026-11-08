import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PNG output for the 9x6 opaque grayscale ramp below.
const native8x4 = [14, 19, 23, 28, 32, 37, 41, 46, 70, 74, 79, 83, 88, 92, 97, 101, 119, 123, 128, 132, 137, 141, 146, 150, 174, 179, 183, 188, 192, 197, 201, 206];
const native8x8 = [2, 7, 11, 16, 20, 25, 29, 34, 23, 28, 32, 37, 41, 46, 50, 55, 54, 59, 63, 68, 72, 77, 81, 86, 81, 86, 90, 95, 99, 104, 108, 113, 107, 112, 116, 121, 125, 130, 134, 139, 134, 139, 143, 148, 152, 157, 161, 166, 164, 168, 173, 178, 182, 187, 191, 196, 186, 191, 195, 200, 204, 209, 213, 218];

for (const [size, mode, divisor, width, height, gray] of [
  ["9:6", "decrease", "4", 8, 4, native8x4],
  ["10:10", "decrease", "4", 8, 8, native8x8],
  ["9:6", "1", "4", 8, 4, native8x4],
  ["9:6", "increase", "4", 12, 8],
  ["10:10", "2", "4", 16, 12],
  ["9:6", "disable", "4", 9, 6],
  ["9:6", "0", "4", 9, 6],
  ["9:6", undefined, "4", 9, 6],
  ["10:10", "decrease", undefined, 10, 7],
  ["9:6", "decrease", "0", 0, 0],
  ["2:2", "decrease", "4", 0, 0],
  ["9:6", "decrease", "257", 0, 0],
  ["9:6", "decrease", "1.5", 0, 0],
  ["9:6", "decrease", "bogus", 0, 0],
  ["9:6", "bogus", "4", 0, 0]
] as const) {
  const filter = `scale=${size}${mode === undefined ? "" : `:force_original_aspect_ratio=${mode}`}${divisor === undefined ? "" : `:force_divisible_by=${divisor}`}`;
  it(`applies and validates ${filter}`, async () => {
    const pixels = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const input = encodeImage({ width: 9, height: 6, data: pixels, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    volume.writeFileSync("/out.png", input);
    const errors: Uint8Array[] = [];
    const context = {
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    };
    const command = createFfmpegCommand();
    const result = await command.execute({ ...context, args: ["-y", "-i", "/in.png", "-vf", filter, "-frames:v", "1", "/out.png"] } as never);
    if (width === 0) {
      assert.notEqual(result.exitCode, 0);
      assert.match(Buffer.concat(errors).toString(), /scale:/);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/out.png") as Buffer), input);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    if (gray) {
      const expected = Uint8Array.from(gray.flatMap(value => [value, value, value, 255]));
      assert.equal(output.data.length, expected.length);
      // Native swscale differs by one level in rounding some interpolated channels.
      for (let i = 0; i < expected.length; i++) {
        assert.ok(Math.abs(output.data[i]! - expected[i]!) <= (i % 4 === 3 ? 0 : 1), `channel ${i}`);
      }
    }
    const reference = await command.execute({ ...context, args: ["-y", "-i", "/in.png", "-vf", `scale=${width}:${height}`, "-frames:v", "1", "/reference.png"] } as never);
    assert.equal(reference.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(output.data, decodeImage(volume.readFileSync("/reference.png") as Buffer).data);
  });
}
