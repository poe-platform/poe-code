import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const values = [12, 40, 72, 112, 144, 176, 204, 232];
for (const [filter, expected, limits] of [
  ["null", values],
  ["loop=2:2:3", null, { maxSamplesPerTrack: 10 }],
  ["loop=2:2:3", null, { maxDurationSeconds: 1 }],
  ["loop=2:2:3", null, { maxFrames: 9 }],
  ["loop=2147483647:2:0", null],
  ["loop=loop=2:size=2:start=3", [12, 40, 72, 112, 72, 112, 72, 112, 144, 176, 204, 232]],
  ["loop=2:2:3", [12, 40, 72, 112, 72, 112, 72, 112, 144, 176, 204, 232]],
  ["loop=1:2:0", [12, 40, 12, 40, 72, 112, 144, 176, 204, 232]],
  ["loop=1.5:2:0", [12, 40, 12, 40, 12, 40, 72, 112, 144, 176, 204, 232]],
  ["loop=1:2:1", [12, 40, 12, 40, 72, 112, 144, 176, 204, 232]],
  ["loop=1:20:3", [...values, 72, 112, 144, 176, 204, 232]],
  ["loop=1:2:8", [...values, 232]],
  ["loop=1:2:9", values],
  ["loop", values],
  ["loop=0:2:3", values],
  ["loop=2:0:3", values],
  ["loop=2:2:3,select='gt(t,0.75)'", [144, 176, 204, 232]],
  ...["-1:2:3", "1:-1:0", "1:2:-2", "nope", "loop=", "unknown=3", "1:2:3:4:5", "2147483648:2:0", "2:32768:0"].map(value => [`loop=${value}`, null] as const)
] as readonly (readonly [string, readonly number[] | null, MediaResourceLimits?])[]) {
  it(`loop repeats frames or safely rejects ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/o01.png": "existing output" });
    for (const [i, value] of values.entries()) {
      const data = new Uint8Array(32 * 32 * 4).fill(value);
      for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
      volume.writeFileSync(`/f${i}.png`, encodeImage({ width: 32, height: 32, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand({ limits }).execute({
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
      if (!limits) assert.ok(stderr.includes("loop:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(paths.map(path => decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data[0]), expected);
    }
  });
}
