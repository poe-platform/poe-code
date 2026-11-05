import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const data = new Uint8Array(8 * 8 * 4);
for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
const input = encodeImage({
  width: 8, height: 8, channels: 4, data,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

for (const [dimensions, boxWidth, boxHeight] of [
  ["w=-1:h=4", 8, 4],
  ["w=-2:h=4", 8, 4],
  ["w=4:h=-1", 4, 8],
  ["w=4:h=-2", 4, 8],
  ["w=0:h=0", 8, 8],
  ["width=-1:height=-2", 8, 8]
] as const) {
  for (const thickness of ["fill", "1"]) {
    it(`drawbox ${dimensions}:t=${thickness} uses frame dimensions for nonpositive sizes`, async (t) => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/input.png", input);
      const filter = `drawbox=x=1:y=1:${dimensions}:color=red:t=${thickness}`;
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
      assert.equal(output.width, 8);
      assert.equal(output.height, 8);
      const expected = new Uint8Array(data);
      for (let y = 1; y < Math.min(8, 1 + boxHeight); y++) {
        for (let x = 1; x < Math.min(8, 1 + boxWidth); x++) {
          if (thickness === "fill" || x === 1 || y === 1 || x === boxWidth || y === boxHeight) {
            expected.set([255, 0, 0, 255], (y * 8 + x) * 4);
          }
        }
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
}
