import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg pixel orders for grayscale rows 10,20,... at each input size.
for (const [width, height, orders] of [
  [3, 2, [
    [10, 40, 20, 50, 30, 60], [40, 10, 50, 20, 60, 30],
    [30, 60, 20, 50, 10, 40], [60, 30, 50, 20, 40, 10]
  ]],
  [2, 3, [
    [10, 30, 50, 20, 40, 60], [50, 30, 10, 60, 40, 20],
    [20, 40, 60, 10, 30, 50], [60, 40, 20, 50, 30, 10]
  ]],
  [2, 2, [
    [10, 30, 20, 40], [30, 10, 40, 20],
    [20, 40, 10, 30], [40, 20, 30, 10]
  ]]
] as const) {
  for (const [direction, name] of ["cclock_flip", "clock", "cclock", "clock_flip"].entries()) {
    for (const value of [name, String(direction)]) {
      for (const options of [value, `dir=${value}`]) {
        it(`transpose=${options} matches native pixels for ${width}x${height}`, async () => {
          const volume = new Volume();
          volume.writeFileSync("/in.png", encodeImage({
            width, height, channels: 4,
            data: Uint8Array.from([10, 20, 30, 40, 50, 60].slice(0, width * height)
              .flatMap(gray => [gray, gray, gray, 255])),
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data);
          const errors: Uint8Array[] = [];
          const result = await createFfmpegCommand().execute({
            args: ["-i", "/in.png", "-vf", `transpose=${options}`, "-frames:v", "1", "/out.png"],
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
          const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
          assert.equal(output.width, height);
          assert.equal(output.height, width);
          assert.deepEqual([...output.data.filter((_, index) => index % 4 === 0)], orders[direction]);
        });
      }
    }
  }
}
