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
const sentinel = encodeImage({
  width: 1, height: 1, channels: 4, data: new Uint8Array([255, 0, 0, 255]),
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

for (const [options, valid] of [
  ["10:8:1:2:black:eval=bogus", false],
  ["10:8:1:2:black:unknown=1", false],
  ["10:8:1:2:black:bogus", false],
  ["10:8:1:2:black:eval=2", false],
  ["10:8:1:2:black:eval=", false],
  ["10:8:1:2:black:init:extra", false],
  ["10:8:1:2:invalid-color", false],
  ["4:4:1:2:black", false],
  ["10:8:1:2:black", true],
  ["10:8:1:2:black:eval=init", true],
  ["10:8:1:2:black:eval=frame", true],
  ["10:8:1:2:black:0", true],
  ["10:8:1:2:black:1", true]
] as const) {
  it(`${valid ? "renders" : "preserves destination for invalid"} pad=${options}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/input.png", input);
    volume.writeFileSync("/output.png", sentinel);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/input.png", "-vf", `pad=${options}`, "-frames:v", "1", "/output.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const bytes = volume.readFileSync("/output.png") as Buffer;
    if (!valid) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).length > 0);
      assert.deepEqual(new Uint8Array(bytes), sentinel);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(bytes);
    assert.equal(output.width, 10);
    assert.equal(output.height, 8);
    const expected = new Uint8Array(10 * 8 * 4);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    for (let y = 0; y < 4; y++) expected.set(data.subarray(y * 24, (y + 1) * 24), ((y + 2) * 10 + 1) * 4);
    assert.deepEqual(output.data, expected);
  });
}
