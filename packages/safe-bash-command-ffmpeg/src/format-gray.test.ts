import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const pixels = Uint8Array.from([255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255,
  255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255]);

for (const [filter, colorType] of [
  ["format=gray", 0],
  ["format=gray8", 0],
  ["format=pix_fmts=gray", 0],
  ["format=gray,format=rgba", 6],
  ["format=gray,format=rgb24", 2],
] as const) {
  it(`${filter} matches native luminance, opaque alpha, and PNG color type`, async () => {
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
    // Native FFmpeg's decoded RGBA values for the same two-row fixture.
    const expected = Uint8Array.from([76, 150, 29, 124, 76, 150, 29, 124]
      .flatMap(gray => [gray, gray, gray, 255]));
    assert.deepEqual(decodeImage(output).data, expected);
    assert.equal(output[24], 8);
    assert.equal(output[25], colorType);
  });
}
