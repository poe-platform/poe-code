import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { image2Ast } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [expression, sar, format, width, height, left, top] of [
  ["10:8:hsub:vsub", 1, undefined, 10, 8, 1, 1],
  ["10:8:a:dar", 1, undefined, 10, 8, 1, 1],
  ["10:8:sar:dar", 1, undefined, 10, 8, 1, 1],
  ["10:8:sar:dar", 2, undefined, 10, 8, 2, 3],
  ["a*8:sar*4:0:0", 2, undefined, 12, 8, 0, 0],
  ["10:8:hsub:vsub", 1, 0, 10, 8, 2, 2],
  ["10:8:hsub:vsub", 1, 12, 10, 8, 2, 2],
  ["10:8:hsub:vsub", 1, 4, 10, 8, 2, 1],
  ["10:8:hsub:vsub", 1, 13, 10, 8, 2, 1],
  ["10:8:hsub:vsub", 1, 5, 10, 8, 1, 1],
  ["iw+hsub*2:ih+vsub*2:hsub:vsub", 1, 0, 10, 8, 2, 2]
] as const) {
  it(`evaluates pad=${expression} with SAR ${sar} and format ${format}`, async () => {
    const data = new Uint8Array(Array.from({ length: 24 }, (_, i) => [i + 20, i + 20, i + 20, 255]).flat());
    const input = encodeImage({ width: 6, height: 4, channels: 4, data,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const hsub = format !== undefined && [0, 4, 12, 13].includes(format) ? 2 : 1;
    const vsub = format === 0 || format === 12 ? 2 : 1;
    const pixels = new Uint8Array(24 + 2 * (6 / hsub) * (4 / vsub)).fill(128);
    for (let i = 0; i < 24; i++) pixels[i] = data[i * 4]!;
    const image = image2Ast();
    // Supply decoded format and SAR metadata through the public AST interface.
    const ast = { ...image, parse(bytes: Uint8Array) {
      const doc = image.parse(bytes);
      return { ...doc, tracks: doc.tracks.map(track => ({ ...track,
        codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: sar, sarHeight: 1 })),
        decodedVideoFrames: Array.from({ length: 3 }, (_, n) => ({
          width: 6, height: 4, data, ptsSeconds: n / 2, durationSeconds: 0.5, keyframe: true,
          ...(format === undefined ? {} : { native: { rgba: data, pixels, width: 6, height: 4, format, colorspace: 0, fullRange: 1 } })
        }))
      })) };
    } };
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand({ asts: [ast] }).execute({
      args: ["-i", "/in.png", "-vf", `pad=${expression}`, "-fps_mode", "passthrough", "-frames:v", "3", "/out%d.png"],
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
    for (let frame = 1; frame <= 3; frame++) {
      const output = decodeImage(new Uint8Array(volume.readFileSync(`/out${frame}.png`) as Uint8Array));
      assert.equal(output.width, width);
      assert.equal(output.height, height);
      const expected = new Uint8Array(width * height * 4);
      for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
      for (let y = 0; y < 4; y++) {
        expected.set(data.subarray(y * 24, (y + 1) * 24), ((y + top) * width + left) * 4);
      }
      assert.deepEqual(output.data, expected);
    }
  });
}
