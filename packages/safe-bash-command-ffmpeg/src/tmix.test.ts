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

const colorSamples = [[55, 80, 172], [55, 180, 60], [122, 62, 72], [230, 20, 230], [60, 120, 100], [80, 176, 90]];
const graySamples = [16, 17, 18, 30, 90, 235].map(value => [value, 128, 128]);
for (const [samples, filter, expected] of [
  [colorSamples, "null", colorSamples],
  [colorSamples, "tmix=frames=1", colorSamples],
  [colorSamples, "tmix=frames=2:weights=0 1", colorSamples],
  [colorSamples, "tmix=frames=2:weights=1 1", [[55, 80, 172], [55, 130, 116], [89, 121, 66], [176, 41, 151], [145, 70, 165], [70, 148, 95]]],
  [graySamples, "tmix=frames=2:weights=2 -1", [16, 15, 16, 6, 0, 0].map(value => [value, 128, 128])],
  [graySamples, "tmix=frames=1", graySamples],
  [graySamples, "tmix=weights=", [16, 16, 17, 22, 46, 118].map(value => [value, 128, 128])],
  [graySamples, "tmix=frames=2:", [16, 17, 18, 24, 60, 163].map(value => [value, 128, 128])],
  [graySamples, "tmix=frames=2", [16, 17, 18, 24, 60, 163].map(value => [value, 128, 128])],
  [graySamples, "tmix=frames=2:weights=1 3:", [16, 17, 18, 27, 75, 199].map(value => [value, 128, 128])],
  [graySamples, "tmix=frames=2:weights=1 3", [16, 17, 18, 27, 75, 199].map(value => [value, 128, 128])],
  [graySamples, "tmix=frames=2:weights=1 0", [16, 16, 17, 18, 30, 90].map(value => [value, 128, 128])]
] as const) {
  for (const chroma of ["420", "422", "444"]) {
    it(`mixes native YUV${chroma} samples: ${filter} (${samples === colorSamples ? "color" : "gray"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.y4m", Buffer.concat([
        Buffer.from(`YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C${chroma}\n`),
        ...samples.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame.flatMap((value, plane) => Array(plane === 0 || chroma === "444" ? 4 : chroma === "422" ? 2 : 1).fill(value)))])
      ]));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", `yuv${chroma}p`, "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected.flatMap(frame => frame.flatMap((value, plane) => Array(plane === 0 || chroma === "444" ? 4 : chroma === "422" ? 2 : 1).fill(value)))));
    });
  }
}
