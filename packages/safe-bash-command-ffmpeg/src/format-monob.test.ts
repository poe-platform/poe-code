import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const row = [255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255];
const expected = [0, 0, 0, 0, 0, 255, 0, 255].flatMap(value => [value, value, value, 255]);
for (const fixture of [
  { width: 4, height: 2, data: Uint8Array.from([...row, ...row]), expected },
  { width: 9, height: 9, data: Uint8Array.from({ length: 9 * 9 * 4 }, (_, i) => i % 4 === 3 ? 17 : 128),
    expected: Array.from({ length: 81 }, (_, i) => i % 2 === 0 ? 255 : 0).flatMap(value => [value, value, value, 255]) },
  { width: 9, height: 2, data: Uint8Array.from({ length: 9 * 2 * 4 }, (_, i) => i % 4 === 3 || i >= 36 ? 255 : 0),
    expected: Array.from({ length: 18 }, (_, i) => i < 9 ? 0 : 255).flatMap(value => [value, value, value, 255]) }
]) {
for (const filter of ["format=monob", "format=pix_fmts=monob", "format=monob,format=monob", "format=monob,format=rgba"]) {
  for (const target of ["/out.png", "/out%02d.png"]) {
    it(`${filter} writes ${fixture.width}x${fixture.height} ${target} with native monochrome pixels`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.png", encodeImage({ width: fixture.width, height: fixture.height,
        data: fixture.data, channels: 4, format: "png", space: "srgb",
        depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data);
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.png", "-vf", filter, "-frames:v", "1", target],
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
      const output = volume.readFileSync(target.includes("%") ? "/out01.png" : target) as Buffer;
      assert.deepEqual([...output.subarray(24, 26)], filter.endsWith("rgba") ? [8, 6] : [1, 0]);
      const decoded = decodeImage(output);
      assert.equal(decoded.width, fixture.width);
      assert.equal(decoded.height, fixture.height);
      assert.deepEqual([...decoded.data], fixture.expected);
    });
  }
}
}
