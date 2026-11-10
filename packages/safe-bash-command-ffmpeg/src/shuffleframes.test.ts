import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const values = [12, 40, 72, 112, 144, 176, 204, 232];
for (const [filter, expected] of [
  ["null", values],
  ["shuffleframes=2 0 1", [72, 12, 40, 176, 112, 144]],
  ["shuffleframes=mapping=2 0 1", [72, 12, 40, 176, 112, 144]],
  ["shuffleframes=2 2 0", [72, 72, 12, 176, 176, 112]],
  ["shuffleframes=2 -1 0", [72, 12, 176, 112]],
  ["shuffleframes=2 -1 0,select='eq(t,0.2)+eq(t,0.5)'", [12, 112]],
  ["shuffleframes=2 0 1,select='eq(t,0)+eq(t,0.3)'", [72, 176]],
  ["shuffleframes", values],
  ["shuffleframes=0", values],
  ["shuffleframes=1 0", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=1 0:", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=mapping=1 0:", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=1|0", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=0x1 0", [12, 12, 72, 72, 144, 144, 204, 204]],
  ["shuffleframes=1.5 0", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=1abc 0", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=mapping=1abc|0", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=+1e2 0", [40, 12, 112, 72, 176, 144, 232, 204]],
  ["shuffleframes=-1.5 0", [12, 72, 144, 204]],
  ["shuffleframes=-1", []],
  ["trim=end_frame=2,shuffleframes=2 0 1", []],
  ["shuffleframes=1 0,shuffleframes=1 0", values],
  ...["3 0 1", "-2 0", "2abc 0", "-2.5 0", ".5 0", "nope", "mapping=", "unknown=0", "0:1", "1 0::", "0:1:"].map(value => [`shuffleframes=${value}`, null] as const)
] as const) {
  it(`shuffleframes selects frames or safely rejects ${filter}`, async () => {
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
      assert.ok(stderr.includes("shuffleframes:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(paths.map(path => decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data[0]), expected);
    }
  });
}
