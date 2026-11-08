import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const data = new Uint8Array(2 * 2 * 3 * 4);
for (let i = 0; i < data.length; i += 4) {
  data[i + Math.floor(i / 16)] = 255;
  data[i + 3] = 255;
}
const input = encodeImage({
  width: 2, height: 6, channels: 4, data,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "gif", pageHeight: 2, delay: [1000, 1000, 1000] }).data;

for (const [filter, indices] of [
  ["trim=start_frame=1:end_frame=2", [1]],
  ["trim=end_frame=1", [0]],
  ["trim=start_frame=1", [1, 2]],
  ["trim=start_frame=0:end_frame=3", [0, 1, 2]],
  ["trim=start=1:end=2", [1]],
  ["trim=start=2:start_frame=1:end=2:end_frame=3", [1, 2]],
  ["trim=0:1", [0]],
  ["trim=start_frame=1:end_frame=3,trim=start_frame=1", [2]],
  ["trim=start_pts=1", [1, 2]],
  ["trim=unknown=1", null],
  ["trim=start_frame=1.5", null],
  ["trim=end_frame=invalid", null]
] as const) {
  it(`${filter} selects input frames or rejects invalid options`, async () => {
    const volume = Volume.fromJSON({ "/out.gif": "existing output" });
    volume.writeFileSync("/in.gif", input);
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.gif", "-vf", filter, "/out.gif"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (indices === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("trim:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const output = decodeImage(volume.readFileSync("/out.gif") as Buffer, { animated: true });
      assert.equal(output.pages ?? 1, indices.length);
      assert.deepEqual(output.data, new Uint8Array(indices.flatMap(index => [...data.subarray(index * 16, (index + 1) * 16)])));
    }
  });
}
