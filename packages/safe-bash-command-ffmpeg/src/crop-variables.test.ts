import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { image2Ast } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [expression, sar, format, width, height, first] of [
  ["4:2:hsub:vsub", 1, undefined, 4, 2, 9],
  ["4:2:a:0", 1, undefined, 4, 2, 2],
  ["4:2:sar:dar", 1, undefined, 4, 2, 9],
  ["4:2:sar:dar", 2, undefined, 4, 2, 24],
  ["a*2:sar*2:0:0", 2, undefined, 3, 4, 1],
  ["hsub*2:vsub*2:0:0", 1, 0, 4, 4, 1],
  ["4:2:hsub:vsub", 1, 0, 4, 2, 17],
  ["4:2:hsub:vsub", 1, 4, 4, 2, 10],
  ["4:2:hsub:vsub:exact=1", 1, 0, 4, 2, 17],
  ["4:2:hsub:vsub", 1, 5, 4, 2, 9]
] as const) {
  it(`evaluates crop=${expression} with SAR ${sar} and format ${format}`, async () => {
    const data = new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat());
    const input = encodeImage({ width: 7, height: 5, channels: 4, data,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const chromaWidth = Math.ceil(7 / (format === 5 ? 1 : 2));
    const chromaHeight = Math.ceil(5 / (format === 0 ? 2 : 1));
    const pixels = new Uint8Array(35 + 2 * chromaWidth * chromaHeight).fill(128);
    for (let i = 0; i < 35; i++) pixels[i] = i + 1;
    const image = image2Ast();
    // Supply decoded format and SAR metadata through the public AST interface.
    const ast = { ...image, parse(bytes: Uint8Array) {
      const doc = image.parse(bytes);
      return { ...doc, tracks: doc.tracks.map(track => ({ ...track,
        codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: sar, sarHeight: 1 })),
        decodedVideoFrames: Array.from({ length: 3 }, (_, n) => ({
          width: 7, height: 5, data, ptsSeconds: n / 2, durationSeconds: 0.5, keyframe: true,
          ...(format === undefined ? {} : { native: { rgba: data, pixels, width: 7, height: 5, format, colorspace: 0, fullRange: 1 } })
        }))
      })) };
    } };
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand({ asts: [ast] }).execute({
      args: ["-i", "/in.png", "-vf", `crop=${expression}`, "-fps_mode", "passthrough", "-frames:v", "3", "/out%d.png"],
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
      assert.deepEqual(output.data, new Uint8Array(Array.from({ length: width * height }, (_, pixel) => {
        const gray = first + Math.floor(pixel / width) * 7 + pixel % width;
        return [gray, gray, gray, 255];
      }).flat()));
    }
  });
}
