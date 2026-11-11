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
for (const [options, width, height] of [
  ["oh*2:6:0:0", 12, 6],
  ["12:ow/2:0:0", 12, 6],
  ["width=out_h*2:height=6:x=0:y=0", 12, 6],
  ["w=12:h=out_w/2:x=0:y=0", 12, 6],
  ["0:ow:0:0", 6, 4],
  ["oh*2:0:0:0", 8, 4],
  ["oh:ow:0:0", null, null],
  ["unknown:6:0:0", null, null],
  ["1/0:6:0:0", null, null],
] as const) {
  it(`resolves dependent output dimensions correctly for pad=${options}`, async () => {
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
    if (width === null || height === null) {
      assert.equal(result.exitCode, 234);
      assert.match(Buffer.concat(errors).toString(), /pad: invalid or unsupported expression/);
      assert.equal(volume.existsSync("/output.png"), false);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/output.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    const expected = new Uint8Array(width * height * 4);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    for (let y = 0; y < 4; y++) expected.set(data.subarray(y * 24, (y + 1) * 24), y * width * 4);
    assert.deepEqual(output.data, expected);
  });
}
