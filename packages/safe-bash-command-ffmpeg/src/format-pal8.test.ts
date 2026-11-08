import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const row = [255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255];
const expected = [252, 0, 0, 255, 0, 252, 0, 255, 0, 0, 255, 255, 216, 108, 0, 255,
  252, 0, 0, 255, 0, 252, 0, 255, 0, 0, 255, 255, 216, 108, 85, 255];
for (const filter of ["format=pal8", "format=pix_fmts=pal8", "format=pal8,format=pal8", "format=pal8,format=rgba"]) {
  for (const target of ["/out.png", "/out%02d.png"]) {
    it(`${filter} writes ${target} with native palette colors`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.png", encodeImage({ width: 4, height: 2,
        data: Uint8Array.from([...row, ...row]), channels: 4, format: "png", space: "srgb",
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
      assert.deepEqual([...output.subarray(24, 26)], [8, filter.endsWith("rgba") ? 6 : 3]);
      const decoded = decodeImage(output);
      assert.equal(decoded.width, 4);
      assert.equal(decoded.height, 2);
      assert.deepEqual([...decoded.data], expected);
      if (!filter.endsWith("rgba")) {
        assert.deepEqual([...decoded.pngPalette!.bytes], Array.from({ length: 768 }, (_, i) => {
          const index = Math.floor(i / 3);
          return i % 3 === 0 ? (index & 7) * 36 : i % 3 === 1 ? ((index >> 3) & 7) * 36 : (index >> 6) * 85;
        }));
        assert.equal(decoded.pngPalette?.transparency, undefined);
      }
    });
  }
}
