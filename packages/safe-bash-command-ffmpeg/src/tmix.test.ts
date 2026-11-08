import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const values = [12, 40, 40, 112, 144, 176, 176, 232];
for (const [filter, expected] of [
  ["null", values],
  ["tmix=frames=3:weights=1 2 1", [12, 19, 33, 58, 102, 144, 168, 190]],
  ["tmix=frames=3:weights=1 2 1,select='eq(t,0)+eq(t,0.7)'", [12, 190]],
  ["trim=end_frame=1,tmix=frames=3:weights=1 2 1", [12]],
  ["tmix=frames=1", values],
  ["tmix", [12, 21, 31, 64, 99, 144, 165, 195]],
  ["tmix=3:1 2", [12, 23, 34, 69, 110, 150, 170, 198]],
  ["tmix=3:1 2 1", [12, 19, 33, 58, 102, 144, 168, 190]],
  ["tmix=frames=3:weights=1 0 0", [12, 12, 12, 40, 40, 112, 144, 176]],
  ...["frames=0", "frames=1025", "frames=2.5", "weights=no", "weights=0 0 0", "unknown=1"].map(value => [`tmix=${value}`, null] as const)
] as const) {
  it(`tmix selects frames or safely rejects ${filter}`, async () => {
    const volume = Volume.fromJSON(expected === null ? { "/o01.png": "existing output" } : {});
    for (const [i, value] of values.entries()) {
      const data = new Uint8Array(32 * 32 * 4).fill(value);
      for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
      volume.writeFileSync(`/f${i}.png`, encodeImage({ width: 32, height: 32, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-framerate", "10", "-i", "/f%d.png", "-vf", filter,
        "-fps_mode", "passthrough", "/o%02d.png"],
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
    const stderr = Buffer.concat(errors).toString();
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("tmix:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.equal(paths.length, expected.length);
      for (const [index, path] of paths.entries()) {
        const image = decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer));
        assert.equal(image.width, 32);
        assert.equal(image.height, 32);
        for (let offset = 0; offset < image.data.length; offset += 4) {
          assert.deepEqual(Array.from(image.data.subarray(offset, offset + 3)), Array(3).fill(expected[index]));
        }
      }
    }
  });
}
