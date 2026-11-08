import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg's first output row for the opaque 9x6 grayscale ramp.
const scaledRow = [4, 6, 10, 13, 15, 18, 22, 25, 27, 30, 34, 36];

for (const size of ["12:0", "0:0", "w=12:h=0", "width=0:height=0"]) {
  it(`scale=${size} resolves zero from its own input axis`, async () => {
    const data = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const input = encodeImage({ width: 9, height: 6, data, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.png", "-vf", `scale=${size}`, "-frames:v", "1", "/out.png"],
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
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    const resized = size.includes("12");
    assert.equal(output.width, resized ? 12 : 9);
    assert.equal(output.height, 6);
    const expected = resized
      ? Uint8Array.from(Array.from({ length: 6 }, (_, y) => scaledRow.flatMap(value => [value + y * 36, value + y * 36, value + y * 36, 255])).flat())
      : data;
    assert.deepEqual(output.data, expected);
  });
}
