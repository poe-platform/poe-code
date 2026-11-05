import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const data = new Uint8Array(5 * 4 * 4);
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 5; x++) data.set([x * 40, y * 50, 100, 255], (y * 5 + x) * 4);
}
const input = encodeImage({
  width: 5, height: 4, channels: 4, data,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

for (const [dimensions, width, height, position, x, y] of [
  ["2:2", 2, 2, "1.5:1.5", 2, 2],
  ["2:2", 2, 2, "0.5:0.5", 0, 0],
  ["2:2", 2, 2, "2.5:1.5", 2, 2],
  ["2:2", 2, 2, "(iw-ow)/2:(ih-oh)/2", 2, 1],
  ["2:2", 2, 2, "x=1.6:y=0.6", 2, 1],
  ["2:2", 2, 2, "1.4:0.4", 1, 0],
  ["2:2", 2, 2, "2:1", 2, 1],
  ["2:2", 2, 2, "-1.5:99.5", 0, 2],
  ["3.5:2.5", 4, 2, "0:0", 0, 0],
  ["2.5:2.5", 2, 2, "0:0", 0, 0],
  ["iw/2:ih/2", 2, 2, "0:0", 0, 0],
  ["iw*0.7:ih*0.625", 4, 2, "0:0", 0, 0],
  ["3.6:2.6", 4, 3, "0:0", 0, 0]
] as const) {
  it(`rounds crop ${dimensions}:${position} to ${width}x${height} at (${x}, ${y})`, async (t) => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/input.png", input);
    const filter = `crop=${dimensions}:${position}`;
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
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * 5 + x) * 4;
      expected.set(data.subarray(start, start + width * 4), row * width * 4);
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
