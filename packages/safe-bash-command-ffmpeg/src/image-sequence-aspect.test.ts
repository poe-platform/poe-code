import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const rgb = Uint8Array.from({ length: 8 * 4 * 3 }, (_, i) =>
  (Math.floor(i / 3) % 8 * 23 + Math.floor(i / 24) * 41 + i % 3 * 53) % 256);

for (const format of ["png", "tiff"] as const) {
  for (const [resolution, filter, aspect] of [
    [undefined, undefined, "0/1"], [undefined, "null", "0/1"],
    [undefined, "setsar=1", "1/1"], [undefined, "setsar=4/3", "4/3"],
    [{ x: 1, y: 1, unit: "unknown" }, undefined, "1/1"],
    [{ x: 4, y: 3, unit: "unknown" }, undefined, "4/3"]
  ] as const) {
    it(`preserves ${format} sequence aspect ${resolution ? `${resolution.x}/${resolution.y}` : "unspecified"} with ${filter ?? "no filter"}`, async () => {
      const volume = Volume.fromJSON({});
      for (const [index, pixels] of [rgb, rgb.slice().reverse()].entries()) {
        const data = Uint8Array.from({ length: 8 * 4 * 4 }, (_, i) =>
          i % 4 === 3 ? 255 : pixels[Math.floor(i / 4) * 3 + i % 4]!);
        const image = encodeImage({ width: 8, height: 4, data, channels: 4,
          format, space: "srgb", depth: "uchar", density: 72, hasAlpha: false,
          ...(resolution ? { resolution } : {}) }, { format, pngColorType: 2 }).data;
        assert.deepEqual(decodeImage(image).resolution, resolution);
        volume.writeFileSync(`/frame${index + 1}.${format}`, image);
      }
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "image2", "-framerate", "2", "-i", `/frame%d.${format}`,
          ...(filter ? ["-vf", filter] : []), "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "framecrc", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      const lines = Buffer.concat(stdout).toString().trim().split("\n");
      assert.ok(lines.includes(`#sar 0: ${aspect}`), lines.join("\n"));
      assert.ok(lines.includes("#tb 0: 1/2"), lines.join("\n"));
      assert.deepEqual(lines.filter(line => !line.startsWith("#"))
        .map(line => line.split(",").map(value => value.trim())), [
        ["0", "0", "0", "1", "96", "0x6bbf3220"],
        ["0", "1", "1", "1", "96", "0x936f3220"]
      ]);
    });
  }
}
