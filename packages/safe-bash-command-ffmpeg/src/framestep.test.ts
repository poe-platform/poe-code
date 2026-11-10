import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const values = [12, 40, 40, 112, 144, 176, 176, 232];
for (const [filter, expected] of [
  ["null", values],
  ["framestep=3", [12, 112, 176]],
  ["framestep=step=3", [12, 112, 176]],
  ["framestep=step=1+1", [12, 40, 144, 176]],
  ["framestep=2.5", [12, 40, 144, 176]],
  ["framestep=3.5", [12, 144]],
  ["framestep=2.6", [12, 112, 176]],
  ["framestep=step='sqrt(4)'", [12, 40, 144, 176]],
  ["framestep=PI", [12, 112, 176]],
  ["framestep", values],
  ["framestep=1", values],
  ["framestep=8", [12]],
  ["framestep=2147483647", [12]],
  ["framestep=3,select='gt(t,0.5)'", [176]],
  ["trim=start_frame=1,framestep=3", [40, 144, 232]],
  ["framestep=3,framestep=2", [12, 176]],
  ...["0", "-1", "0.9", "2147483647.1", "2147483648", "1/0", "0/0", "nope", "step=", "unknown=3", "3:2"].map(value => [`framestep=${value}`, null] as const)
] as const) {
  it(`framestep selects frames or safely rejects ${filter}`, async () => {
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
      assert.ok(stderr.includes("framestep:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(paths.map(path => decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data[0]), expected);
    }
  });
}
