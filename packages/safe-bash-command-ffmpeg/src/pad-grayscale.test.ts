import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const hasAlpha of [false, true]) {
  for (const [color, gray, alpha, width] of [
    ["red", 76, 255, 4],
    ["red@0.5", 76, 127, 4],
    ["lime", 150, 255, 4],
    ["blue", 29, 255, 4],
    ["red", 76, 255, 2]
  ] as const) {
    it(`pads ${hasAlpha ? "gray-alpha" : "gray"} PNG to width ${width} with ${color} in its original pixel format`, async () => {
      const source = new Uint8Array([48, 48, 48, hasAlpha ? 64 : 255, 77, 77, 77, 255]);
      const input = encodeImage({
        width: 2, height: 1, data: source, channels: hasAlpha ? 2 : 1,
        space: "b-w", hasAlpha, format: "png", depth: "uchar", density: 72
      }, { format: "png" }).data;
      assert.equal(input[25], hasAlpha ? 4 : 0);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/input.png", input);
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/input.png", "-vf", `pad=${width}:1:${width === 4 ? 1 : 0}:0:${color}`, "-frames:v", "1", "/output.png"],
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
      const bytes = volume.readFileSync("/output.png") as Buffer;
      const output = decodeImage(bytes);
      assert.equal(output.width, width);
      assert.equal(output.height, 1);
      const border = [gray, gray, gray, hasAlpha ? alpha : 255];
      assert.deepEqual(output.data, width === 2 ? source : new Uint8Array([...border, ...source, ...border]));
      assert.equal(bytes[25], hasAlpha ? 4 : 0);
    });
  }
}
