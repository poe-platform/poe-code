import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of decoded RGBA bytes from FFmpeg 7.0.2, including alpha and border pixels.
// ffmpeg -i in.png -vf rotate=<options> -frames:v 1 -f rawvideo -pix_fmt rgba pipe:1
for (const [width, height, options, expected] of [
  [35, 29, "0", "b53bfe1b0df98ffa40d5849d61366a04afcca443460d8b1b72918ce7a32c9d82"],
  [35, 29, "0.4", "c4762aad6740562b3d8b5a610f706f0a2f06b0340a681376bd1d1cf15a30da33"],
  [35, 29, "0.1234567", "8780fd83004a4a3f998c9787410e1cf8d3774ccab52bbefe0c294aee8a47082e"],
  [35, 29, "PI/3", "2e8c7404d3f2c72f8ca8ce784676fe4f52710bb3ea91c6a2ed4d04dd797aa4e7"],
  [35, 29, "-0.4", "f8c8fe03baa48d289126a26d22974ab31bb972cb649c121ac986252c9360890e"],
  [34, 28, "0.4", "23baae319b64394d545e924b090a8139eb87405fd1259b127b6000d7fcd4025a"],
  [35, 29, "0.4:ow=38:oh=32", "6d633861522204a520c9a4fb8f204f5195a67315498c16949ca158807ac65ddf"],
  [35, 29, "0.4:bilinear=0", "96d61811408d276408a3193bad3973cb8fef44791312dc9bf3d8a21d5888b081"],
  [34, 28, "-0.1234567", "b4f870b0e2f75b25a8098e53a56336e641d7ac3bd94edb40e0bacf3017aa188b"]
] as const) {
  it(`matches native RGBA subpixel rotation ${options} on ${width}x${height}`, async () => {
    const data = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      data.set([(11 + pixel * 71) % 256, (5 + pixel * 93) % 256,
        (241 + pixel * 131) % 256, (55 + pixel * 29) % 256], pixel * 4);
    }
    const input = encodeImage({ width, height, channels: 4, data,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const volume = Volume.fromJSON({ "/in.png": Buffer.from(input) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.png", "-vf", `rotate=${options}`, "-frames:v", "1", "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, options.includes("ow=") ? 38 : width);
    assert.equal(output.height, options.includes("oh=") ? 32 : height);
    assert.equal(output.channels, 4);
    if (width === 35 && options === "0.4") {
      assert.deepEqual(Array.from(output.data.subarray((6 * width + 15) * 4, (6 * width + 16) * 4)), [54, 72, 112, 81]);
    }
    assert.equal(createHash("sha256").update(output.data).digest("hex"), expected);
  });
}
