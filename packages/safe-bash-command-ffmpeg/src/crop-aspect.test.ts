import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { image2Ast } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [keepAspect, x, y] of [[0, 2, 1], [1, 7, 5], ["n", 2, 1], ["N", 2, 1], ["y", 7, 5], ["Y", 7, 5], ["+1", 7, 5], ["01", 7, 5], ["enable", 7, 5], ["-0", 2, 1], ["disable", 2, 1]] as const) {
  it(`preserves crop sample aspect ratio with keep_aspect=${keepAspect}`, async () => {
    const data = new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat());
    const input = encodeImage({ width: 7, height: 5, channels: 4, data,
      resolution: { x: 2, y: 1, unit: "unknown" }, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    for (let n = 1; n <= 3; n++) volume.writeFileSync(`/in${n}.png`, input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand({ asts: [image2Ast()] }).execute({
      args: ["-framerate", "2", "-i", "/in%d.png", "-vf", `crop=4:2:0:0:keep_aspect=${keepAspect}`, "-fps_mode", "passthrough", "-frames:v", "3", "/out%d.png"],
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
      assert.deepEqual(output.resolution, { x, y, unit: "unknown" });
      assert.equal(output.width, 4);
      assert.equal(output.height, 2);
      assert.deepEqual(output.data, new Uint8Array(Array.from({ length: 4 * 2 }, (_, pixel) => {
        const gray = 1 + Math.floor(pixel / 4) * 7 + pixel % 4;
        return [gray, gray, gray, 255];
      }).flat()));
    }
  });
}
