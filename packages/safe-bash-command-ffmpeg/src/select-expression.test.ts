import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [expression, count] of [
  ["between(n,1,2)", 2], ["gt(n,1)", 2], ["eq(n,1)", 1],
  ["not(mod(n,2))", 2], ["eq(n,1)+eq(n,3)", 2],
  ["eq(n,1)*eq(n,3)", 0], ["gt(t,1.5)", 2], ["0", 0], ["1", 4],
  ["lt(selected_n,2)", 2], ["isnan(prev_selected_n)+gte(n-prev_selected_n,3)", 2],
  ["lte(t-start_t,2)", 3], ["eq(key,1)", 4],
  ["isnan(prev_selected_t)+gte(t-prev_selected_t,2)", 2],
  ["isnan(prev_t)", 1], ["prev_selected_n", 1],
  ["unknown(n)", null], ["eq(n,1)+unknown(n)", null],
  ["eq(n,1)junk", null], ["between(n,1)", null], ["not(n,1)", null],
  ["eq(n,1", null], ["scene", 0]
] as const) {
  it(`select evaluates or rejects the entire expression ${expression}`, async () => {
    const volume = Volume.fromJSON({ "/out_1.png": "existing output" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
        "-vf", `select='${expression}'`, "-fps_mode", "passthrough", "/out_%d.png"],
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
    if (count === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("select:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else if (count === 0) {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const written = Object.entries(volume.toJSON()).filter(([, value]) => value !== "existing output");
      assert.equal(written.length, count);
    }
  });
}

for (const [filter, expected] of [
  ["select='lt(selected_n,2)'", [12, 40]],
  ["select='isnan(prev_selected_n)+gte(n-prev_selected_n,3)'", [12, 112, 176]],
  ["select='lte(t-start_t,0.2)'", [12, 40, 40]],
  ["select='eq(key,1)'", [12, 40, 40, 112, 144, 176, 176, 232]],
  ["select='isnan(prev_selected_t)+gte(t-prev_selected_t,0.25)'", [12, 112, 176]],
  ["setpts=PTS+5,select='lte(t-start_t,0.25)'", [12, 40, 40]],
  ["select='not(mod(n,2))',select='lt(selected_n,2)'", [12, 40]]
] as const) {
  it(`select preserves the expected source frames: ${filter}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [index, value] of [12, 40, 40, 112, 144, 176, 176, 232].entries()) {
      const data = new Uint8Array(32 * 32 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
      volume.writeFileSync(`/f${index}.png`, encodeImage({
        width: 32, height: 32, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data);
    }
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", "10", "-i", "/f%d.png", "-vf", filter,
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
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const values = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort()
      .map(path => decodeImage(volume.readFileSync(path) as Buffer).data[0]);
    assert.deepEqual(values, expected);
  });
}
