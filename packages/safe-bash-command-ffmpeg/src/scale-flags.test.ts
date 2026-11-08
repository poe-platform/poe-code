import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg RGBA references for the opaque 9x6 grayscale ramp.
const references = [
  ["bicubic", 12, 8, [2, 4, 8, 11, 13, 16, 19, 23, 25, 28, 32, 34, 23, 25, 29, 32, 35, 38, 41, 44, 47, 50, 53, 55, 54, 56, 59, 62, 65, 68, 71, 74, 77, 80, 84, 86, 81, 83, 87, 90, 93, 96, 99, 102, 105, 108, 111, 113, 107, 109, 112, 115, 118, 121, 124, 127, 130, 133, 137, 139, 134, 136, 140, 143, 146, 149, 152, 155, 158, 161, 164, 166, 164, 166, 169, 172, 175, 178, 181, 184, 187, 190, 194, 196, 186, 188, 192, 195, 197, 201, 204, 207, 209, 213, 216, 218]],
  ["bicubic", 5, 4, [15, 22, 30, 37, 44, 71, 78, 85, 93, 100, 120, 127, 135, 142, 149, 176, 183, 190, 197, 205]],
  ["bilinear", 12, 8, [4, 7, 10, 12, 15, 18, 21, 24, 28, 31, 34, 36, 27, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 58, 54, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83, 85, 80, 83, 86, 89, 92, 95, 98, 101, 104, 107, 110, 113, 108, 110, 113, 116, 119, 122, 125, 128, 131, 134, 137, 140, 135, 137, 140, 143, 146, 149, 152, 155, 158, 161, 164, 166, 162, 164, 167, 170, 173, 176, 179, 182, 185, 188, 191, 193, 184, 186, 190, 193, 196, 199, 202, 204, 207, 210, 213, 216]],
  ["bilinear", 5, 4, [20, 26, 33, 41, 48, 70, 77, 84, 91, 98, 122, 128, 136, 143, 150, 174, 181, 188, 195, 202]],
  ["area", 12, 8, [4, 7, 10, 12, 15, 18, 21, 24, 28, 31, 34, 36, 27, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 58, 54, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83, 85, 80, 83, 86, 89, 92, 95, 98, 101, 104, 107, 110, 113, 108, 110, 113, 116, 119, 122, 125, 128, 131, 134, 137, 140, 135, 137, 140, 143, 146, 149, 152, 155, 158, 161, 164, 166, 162, 164, 167, 170, 173, 176, 179, 182, 185, 188, 191, 193, 184, 186, 190, 193, 196, 199, 202, 204, 207, 210, 213, 216]],
  ["area", 5, 4, [18, 25, 32, 39, 46, 66, 73, 80, 87, 94, 126, 133, 140, 147, 154, 174, 181, 188, 195, 202]],
  ["lanczos", 12, 8, [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 54, 56, 60, 63, 66, 69, 72, 75, 78, 81, 84, 86, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108, 111, 113, 107, 109, 112, 115, 118, 121, 124, 127, 130, 133, 136, 139, 134, 136, 139, 142, 145, 148, 151, 154, 157, 160, 164, 166, 166, 168, 172, 175, 178, 181, 184, 187, 190, 193, 196, 198, 187, 189, 193, 196, 199, 202, 205, 208, 211, 214, 217, 219]],
  ["lanczos", 5, 4, [12, 19, 27, 34, 42, 72, 79, 87, 94, 102, 118, 126, 133, 140, 148, 176, 184, 191, 198, 206]]
] as const;

for (const [flag, width, height, expected] of references) {
  it(`scale=${width}:${height}:flags=${flag} matches native pixels`, async () => {
    const inputPixels = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const png = (width: number, height: number, data: Uint8Array) => encodeImage({
      width, height, data, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;

    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", png(9, 6, inputPixels));

    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.png", "-vf", `scale=${width}:${height}:flags=${flag}`, "-frames:v", "1", "/out.png"],
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
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    if (width === 12) {
      const gray = { bicubic: 23, bilinear: 27, area: 27, lanczos: 22 };
      assert.equal(output.data[width * 4], gray[flag]);
    }
    // swscale uses fixed-point coefficients; allow one level of rounding error.
    for (const [index, value] of expected.entries()) {
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(output.data[index * 4 + channel]! - value) <= 1,
          `pixel ${index}, channel ${channel}: ${output.data[index * 4 + channel]} vs ${value}`);
      }
      assert.equal(output.data[index * 4 + 3], 255);
    }
  });
}
