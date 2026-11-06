import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const output of ["/out.png", "/out%02d.png"]) {
  for (const limit of [undefined, 1, 2]) {
    it(`image2 update writes every processed frame to ${output}, limit ${limit ?? "none"}`, async () => {
      const volume = new Volume();
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
      colors.forEach((color, i) => volume.writeFileSync(`/f0${i}.png`, encodeImage({
        width: 16, height: 16, channels: 4,
        data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, channel) => color[channel % 4]!),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data));
      const writes: { path: string; pixel: number[] }[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/f%02d.png", "-update", "1",
          ...(limit === undefined ? [] : ["-frames:v", String(limit)]), output],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) {
            writes.push({ path, pixel: [...decodeImage(bytes).data.slice(0, 4)] });
            volume.writeFileSync(path, bytes);
          },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const expected = colors.slice(0, limit ?? 3);
      assert.deepEqual(writes, expected.map(pixel => ({ path: output, pixel })));
      assert.deepEqual(volume.readdirSync("/"), ["f00.png", "f01.png", "f02.png", output.slice(1)]);
      assert.deepEqual([...decodeImage(volume.readFileSync(output) as Buffer).data.slice(0, 4)], expected.at(-1));
    });
  }
}
