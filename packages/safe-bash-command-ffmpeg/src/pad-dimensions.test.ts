import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const data = new Uint8Array(4 * 3 * 4);
for (let y = 0; y < 3; y++) {
  for (let x = 0; x < 4; x++) data.set([x * 40, y * 50, 100, 255], (y * 4 + x) * 4);
}
const input = encodeImage({
  width: 4, height: 3, channels: 4, data,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

for (const [dimensions, width, height] of [
  ["iw*1.375:ih*1.5", 5, 4],
  ["iw*1.625:ih*1.5", 6, 4],
  ["iw/0.75:ih/0.625", 5, 4],
  ["5.5:4.5", 5, 4],
  ["6:5", 6, 5],
  ["0:0", 4, 3]
] as const) {
  it(`truncates pad ${dimensions} to ${width}x${height}`, async (t) => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/input.png", input);
    const filter = `pad=${dimensions}:0:0:black`;
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/input.png", "-vf", filter, "-frames:v", "1", "/output.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/output.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    const expected = new Uint8Array(width * height * 4);
    for (let offset = 3; offset < expected.length; offset += 4) expected[offset] = 255;
    for (let row = 0; row < 3; row++) {
      expected.set(data.subarray(row * 16, (row + 1) * 16), row * width * 4);
    }
    assert.deepEqual(output.data, expected);
    await t.test("matches native FFmpeg decoded PNG", { skip: !nativeAvailable }, () => {
      const native = spawnSync("ffmpeg", [
        "-v", "error", "-i", "pipe:0", "-vf", filter,
        "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"
      ], { input });
      assert.equal(native.status, 0, native.stderr.toString());
      const decoded = decodeImage(native.stdout);
      assert.equal(output.width, decoded.width);
      assert.equal(output.height, decoded.height);
      assert.deepEqual(output.data, decoded.data);
    });
  });
}
