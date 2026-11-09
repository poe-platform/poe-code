import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const hasAlpha of [false, true]) {
  for (const [color, alpha] of [["red@0.5", 127], ["red@0", 0], ["0xff000080", 128], ["red", 255]] as const) {
    it(`pad keeps ${hasAlpha ? "RGBA" : "RGB"} input format with ${color} borders`, async () => {
      const data = new Uint8Array([0, 0, 255, 255, 0, 255, 0, 255]);
      const input = encodeImage({
        width: 2, height: 1, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha
      }, { format: "png", forceOpaque: !hasAlpha }).data;
      assert.equal(input[25], hasAlpha ? 6 : 2);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/input.png", input);
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/input.png", "-vf", `pad=4:1:1:0:${color}`, "-frames:v", "1", "/output.png"],
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
      assert.equal(bytes[25], hasAlpha ? 6 : 2);
      const output = decodeImage(bytes);
      assert.equal(output.width, 4);
      assert.equal(output.height, 1);
      const border = [255, 0, 0, hasAlpha ? alpha : 255];
      assert.deepEqual([...output.data], [...border, ...data, ...border]);
    });
  }
}
