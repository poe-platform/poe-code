import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const pixels = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
const input = encodeImage({
  width: 2, height: 1, channels: 4, data: pixels,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

// Expected RGBA samples from FFmpeg 7.0.2, including its asymmetric gray spellings.
for (const [color, expected] of [
  ["tomato", [255, 99, 71, 255]],
  ["LightSteelBlue", [176, 196, 222, 255]],
  ["ToMaTo", [255, 99, 71, 255]],
  ["LightGrey", [211, 211, 211, 255]],
  ["gray", [128, 128, 128, 255]],
  ["DarkGray", [169, 169, 169, 255]],
  ["YellowGreen", [154, 205, 50, 255]],
  ["tomato@0.5", [255, 99, 71, 127]],
  ["LightSteelBlue@0x80", [176, 196, 222, 128]],
  ["FF6347", [255, 99, 71, 255]],
  ["B0C4DE", [176, 196, 222, 255]],
  ["grey", undefined],
  ["LightGray", undefined],
  ["DarkGrey", undefined],
  ["rebeccapurple", undefined],
  ["transparent", undefined],
  ["constructor", undefined]
] as const) {
  it(`${expected ? "renders" : "preserves output for unsupported"} pad color ${color}`, async () => {
    const volume = Volume.fromJSON({ "/input.png": Buffer.from(input), "/output.png": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/input.png", "-vf", `pad=4:1:1:0:${color}`, "-frames:v", "1", "/output.png"],
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
    if (!expected) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes(`Invalid color: ${color}`));
      assert.equal(bytes.toString(), "KEEP");
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(bytes[25], 6, "PNG retains RGBA color type");
    const output = decodeImage(bytes);
    assert.equal(output.width, 4);
    assert.equal(output.height, 1);
    assert.deepEqual([...output.data], [...expected, ...pixels, ...expected]);
  });
}
