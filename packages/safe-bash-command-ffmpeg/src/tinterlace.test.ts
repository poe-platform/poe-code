import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const values = [12, 40, 40, 112, 144, 176, 176, 232];
for (const [filter, expected] of [
  ["null", values.map(value => [value, value])],
  ["tinterlace=mode=interleave_top", [[12,40],[40,112],[144,176],[176,232]]],
  ["tinterlace=interleave_top", [[12,40],[40,112],[144,176],[176,232]]],
  ["tinterlace=interleave_bottom", [[40,12],[112,40],[176,144],[232,176]]],
  ["tinterlace=5", [[40,12],[112,40],[176,144],[232,176]]],
  ["tinterlace=mode=4.6", [[40,12],[112,40],[176,144],[232,176]]],
  ["tinterlace=4", [[12,40],[40,112],[144,176],[176,232]]],
  ...["mode=2+2", "mode=4.4", "2+2", "mode=3.5", "mode=4.5", "mode=interleave_top+0", "mode=interleave_bottom-1", "mode=PI+1"].map(value =>
    [`tinterlace=${value}`, [[12,40],[40,112],[144,176],[176,232]]] as const),
  ["trim=end_frame=7,tinterlace=mode=interleave_top", [[12,40],[40,112],[144,176]]],
  ["trim=end_frame=1,tinterlace=mode=interleave_top", []],
  ["tinterlace=mode=interleave_top,select='eq(t,0.2)'", [[40,112]]],
  ...["mode=merge", "mode=invalid", "mode=3.4", "mode=8", "mode=0/0", "mode=1/0", "mode=2+", "mode=interleave_top:flags=1", "unknown=4"].map(value => [`tinterlace=${value}`, null] as const)
] as const) {
  it(`tinterlace weaves rows or safely rejects ${filter}`, async () => {
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
      assert.ok(stderr.includes("tinterlace:"), stderr);
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
          assert.deepEqual(Array.from(image.data.subarray(offset, offset + 3)), Array(3).fill(expected[index]![Math.floor(offset / (image.width * 4)) % 2]));
        }
      }
    }
  });
}
