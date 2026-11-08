import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const duplicates = [12, 40, 40, 112, 144, 176, 176, 232];
const unique = [12, 40, 72, 112, 144, 176, 204, 232];
for (const [values, filter, expected] of [
  [duplicates, "null", duplicates],
  [unique, "null", unique],
  [duplicates, "decimate=cycle=4", [12, 40, 112, 144, 176, 232]],
  [unique, "decimate=cycle=4", [40, 72, 112, 144, 176, 232]],
  [duplicates, "decimate=4", [12, 40, 112, 144, 176, 232]],
  [duplicates, "decimate", [12, 40, 112, 144, 176, 176, 232]],
  [unique, "decimate=2", [40, 112, 144, 232]],
  [duplicates.slice(0, 7), "decimate=4", [12, 40, 112, 144, 176, 176]],
  [[12, 40, 72], "decimate=4", [12, 40, 72]],
  [[40, 40, 40, 40, 40, 40, 40, 40], "decimate=4", [40, 40, 40, 40, 40, 40]],
  [duplicates, "decimate=25", duplicates],
  [duplicates, "decimate=4,select='between(t,0.25,0.41)'", [112, 144]],
  [unique, "decimate=4,select='lt(t,0.2)'", [40]],
  [duplicates, "decimate=cycle=1", null],
  [duplicates, "decimate=cycle=26", null],
  [duplicates, "decimate=cycle=2.5", null],
  [duplicates, "decimate=cycle=oops", null],
  [duplicates, "decimate=cycle=", null],
  [duplicates, "decimate=unknown=4", null],
  [duplicates, "decimate=4:1", null]
] as const) {
  it(`decimate: ${filter} on ${values}`, async () => {
    const volume = Volume.fromJSON({ "/o01.png": "existing output" });
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
      assert.ok(stderr.includes("decimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(paths.map(path => decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data[0]), expected);
    }
  });
}
