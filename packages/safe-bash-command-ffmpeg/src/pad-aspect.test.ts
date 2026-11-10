import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const pixels = Buffer.from("321ed4ff78b43c80508cbe40122fc700", "hex");

for (const sar of [undefined, 1, 2] as const) {
  const input = sar === undefined ? pixels : encodeImage({
    width: 2, height: 2, channels: 4, data: pixels,
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true,
    resolution: { x: sar, y: 1, unit: "unknown" }
  }, { format: "png" }).data;
  for (const [filter, ...sizes] of [
    ["pad=aspect=1", null, [2, 2], [2, 4]],
    ["pad=aspect=4/3", null, [3, 2], [2, 3]],
    ["pad=aspect=2", null, [4, 2], [2, 2]],
    ["pad=aspect=0", [2, 2], [2, 2], [2, 2]],
    ["null", [2, 2], [2, 2], [2, 2]],
    ["pad=iw*sar:ih", [2, 2], [2, 2], [4, 2]],
    ["null,pad=aspect=2", null, [4, 2], [2, 2]],
    ["crop=iw:ih:keep_aspect=1,pad=aspect=2", null, [4, 2], [2, 2]]
  ] as const) {
    const dimensions = sizes[sar ?? 0];
    for (const graph of [false, true]) {
      it(`pad retains ${sar ?? "unknown"} input SAR for ${filter} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in1.png": Buffer.from(input), "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y",
            ...(sar === undefined ? ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4"] : []),
            "-i", sar === undefined ? "/in1.png" : "/in%d.png", ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (dimensions === null) {
          assert.equal(result.exitCode, 234, stderr);
          assert.ok(stderr.includes("Padded dimensions cannot be smaller than input dimensions"), stderr);
          assert.equal(volume.readFileSync("/out.raw").length, 0);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const [width, height] = dimensions;
        const expected = Buffer.alloc(width * height * 4);
        for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
        for (let y = 0; y < 2; y++) expected.set(pixels.subarray(y * 8, y * 8 + 8), y * width * 4);
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      });
    }
  }
}
