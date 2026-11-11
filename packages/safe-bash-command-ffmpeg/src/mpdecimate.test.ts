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
  [duplicates, "mpdecimate", [12, 40, 112, 144, 176, 232]],
  [unique, "mpdecimate", unique],
  [duplicates, "mpdecimate,select='gte(t,0.3)'", [112, 144, 176, 232]],
  [duplicates, "mpdecimate,select='eq(t,0.5)'", [176]],
  [[40, 44, 48, 52, 56], "mpdecimate", [40, 48, 56]],
  [[40, 40, 40], "mpdecimate", [40]],
  [duplicates, "mpdecimate=unknown=1", null]
] as const) {
  it(`mpdecimate preserves frames and timestamps: ${filter} on ${values}`, async () => {
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
      assert.ok(stderr.includes("mpdecimate:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(paths.map(path => decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data[0]), expected);
    }
  });
}

for (const [format, width, height, middleChroma, expected] of [
  ["yuv420p", 16, 16, 152, [0, 2]],
  ["yuv420p", 16, 16, 128, [0, 2]],
  ["yuv420p", 32, 16, 152, [0, 1, 2]],
  ["yuv420p", 32, 8, 152, [0, 2]],
  ["yuv422p", 16, 16, 152, [0, 2]],
  ["yuv422p", 32, 8, 152, [0, 1, 2]],
  ["yuv444p", 16, 16, 152, [0, 1, 2]]
] as const) {
  for (const plane of ["u", "v"]) {
    it(`mpdecimate scans ${format} ${width}x${height} ${plane} at native dimensions (${middleChroma})`, async () => {
      const chromaSize = Math.ceil(width / (format === "yuv444p" ? 1 : 2)) *
        Math.ceil(height / (format === "yuv420p" ? 2 : 1));
      const frames = [40, 40, 100].map((y, index) => Buffer.concat([
        Buffer.alloc(width * height, y),
        Buffer.alloc(chromaSize, index === 1 && plane === "u" ? middleChroma : 128),
        Buffer.alloc(chromaSize, index === 1 && plane === "v" ? middleChroma : 128)
      ]));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", Buffer.concat(frames));
      const output: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", format,
          "-video_size", `${width}x${height}`, "-framerate", "4", "-i", "/in.raw",
          "-vf", "mpdecimate,showinfo", "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), Buffer.concat(expected.map(index => frames[index]!)));
      const timestamps = stderr.split("\n").filter(line => line.includes("pts_time:"))
        .map(line => Number(line.split("pts:")[1]!.trim().split(" ")[0]));
      assert.deepEqual(timestamps, expected);
    });
  }
}
