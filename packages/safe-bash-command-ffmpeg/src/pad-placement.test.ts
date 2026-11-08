import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const data = new Uint8Array(Array.from({ length: 24 }, (_, i) => [20 + i, 20 + i, 20 + i, 255]).flat());
const input = encodeImage({
  width: 6, height: 4, channels: 4, data,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;
for (const [options, left, top] of [
  ["10:8:5:0", 2, 0],
  ["10:8:0:5", 0, 2],
  ["10:8:99:99", 2, 2],
  ["10:8:4:4", 4, 4],
  ["10:8:-1:-1", 2, 2]
] as const) {
  it(`places the complete source correctly for pad=${options}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/input.png", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/input.png", "-vf", `pad=${options}`, "-frames:v", "1", "/output.png"],
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
    const output = decodeImage(volume.readFileSync("/output.png") as Buffer);
    assert.equal(output.width, 10);
    assert.equal(output.height, 8);
    const expected = new Uint8Array(10 * 8 * 4);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    for (let y = 0; y < 4; y++) expected.set(data.subarray(y * 24, (y + 1) * 24), ((y + top) * 10 + left) * 4);
    assert.deepEqual(output.data, expected);
  });
}
