import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const pixels = Uint8Array.from([255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255,
  255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255]);

for (const [filter, colorType, depth = 8] of [
  ["format=gray16be", 0, 16],
  ["format=pix_fmts=gray16be", 0, 16],
  ["format=gray16be,format=rgba", 6],
  ["format=rgba64be", 6, 16],
  ["format=rgb48be", 2, 16],
  ["format=rgba64be,format=rgba", 6],
  ["format=rgba", 6],
] as const) {
  it(`${filter} writes the requested PNG depth, color type, and pixels`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", encodeImage({ width: 4, height: 2, data: pixels,
      channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.png", "-vf", filter, "-frames:v", "1", "/out.png"],
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
    const output = volume.readFileSync("/out.png") as Buffer;
    // The command expands its decoded 8-bit channels to 16-bit PNG samples.
    const expected = Uint8Array.from([76, 150, 29, 124, 76, 150, 29, 124]
      .flatMap(gray => [gray, gray, gray, 255]));
    assert.deepEqual(decodeImage(output).data, filter.includes("gray") ? expected
      : filter.includes("rgb48") ? pixels.map((v, i) => i % 4 === 3 ? 255 : v) : pixels);
    assert.equal(output[24], depth);
    assert.equal(output[25], colorType);
    if (depth === 16) {
      const decoded = decodeImage(output);
      assert.deepEqual(decoded.data16, Uint16Array.from(decoded.data, value => value * 257));
    }
  });
}
