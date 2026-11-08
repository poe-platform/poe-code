import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const row = [255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255];
// Native FFmpeg's BT.601 conversion; scalar/SIMD implementations differ by 1–2 levels.
for (const [format, expected] of [
  ["yuv420p", [89, 88, 0, 255, 164, 163, 37, 255, 52, 1, 105, 255, 148, 97, 201, 255]],
  ["yuv422p", [89, 88, 0, 255, 164, 163, 37, 255, 52, 1, 105, 255, 148, 97, 201, 255]],
  ["yuv444p", [254, 0, 0, 255, 0, 255, 1, 255, 0, 0, 255, 255, 200, 101, 50, 255]]
] as const) {
  for (const suffix of [",format=rgba", `,format=${format},format=rgba`]) {
    it(`applies ${format}${suffix} before encoding RGBA PNG`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.png", encodeImage({ width: 4, height: 2,
        data: Uint8Array.from([...row, ...row]), channels: 4, format: "png", space: "srgb",
        depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data);
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.png", "-vf", `format=${format}${suffix}`, "-frames:v", "1", "/out.png"],
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
      const output = volume.readFileSync("/out.png") as Buffer;
      assert.deepEqual([...output.subarray(24, 26)], [8, 6]);
      const decoded = decodeImage(output);
      assert.equal(decoded.width, 4);
      assert.equal(decoded.height, 2);
      for (const [i, value] of decoded.data.entries()) {
        assert.ok(Math.abs(value - expected[i % 16]!) <= (i % 4 === 3 ? 0 : 2),
          `channel ${i}: expected ${expected[i % 16]}, got ${value}`);
      }
    });
  }
}

it("subsamples both axes for 420 and only columns for 422, including odd edges", async () => {
  const { formatYuv } = await import("./format-yuv.js");
  const data = Uint8Array.from([
    255, 0, 0, 64, 255, 0, 0, 64, 0, 0, 255, 64,
    0, 0, 255, 64, 0, 0, 255, 64, 255, 0, 0, 64,
    0, 255, 0, 64, 0, 255, 0, 64, 0, 255, 0, 64
  ]);
  const frame = { width: 3, height: 3, data, ptsSeconds: 0, durationSeconds: 1, keyframe: true };
  const full = await formatYuv(frame, "yuv444p");
  const half = await formatYuv(frame, "yuv422p");
  const quarter = await formatYuv(frame, "yuv420p");
  assert.deepEqual([...full.native!.pixels.subarray(9, 18)], [90, 90, 240, 240, 240, 90, 54, 54, 54]);
  assert.deepEqual([...half.native!.pixels.subarray(9, 15)], [90, 240, 240, 90, 54, 54]);
  assert.deepEqual([...quarter.native!.pixels.subarray(9, 13)], [165, 165, 54, 54]);
  assert.equal(await formatYuv(quarter, "yuv420p"), quarter);
  for (const converted of [full, half, quarter]) {
    assert.equal(converted.data.length, data.length);
    for (let i = 3; i < data.length; i += 4) assert.equal(converted.data[i], 255);
  }
});
