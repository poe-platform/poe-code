import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const colors = [[255, 0, 0], [0, 0, 255]];
for (const codec of ["png", "ppm", "pgm", "bmp", "qoi", "mjpeg"] as const) {
  const format = codec === "mjpeg" ? "jpeg" : codec;
  const packets = colors.map((color, index) => {
    if (codec === "ppm" || codec === "pgm") {
      const samples = codec === "pgm" ? [index ? 29 : 76] : color;
      return Buffer.concat([Buffer.from(`${codec === "ppm" ? "P6" : "P5"}\n# frame\n2 2\n255\n`),
        Buffer.from(Array.from({ length: 4 }, () => samples).flat())]);
    }
    return encodeImage({ width: 2, height: 2, channels: 4,
      data: Uint8Array.from(Array.from({ length: 4 }, () => [...color, 255]).flat()),
      format, space: "srgb", depth: "uchar", density: 72, hasAlpha: false
    }, { format, quality: 100 }).data;
  });
  for (const source of ["/stream.bin", "pipe:0"]) {
    for (const mode of ["decode", "default", "auto", "trimmed", "copy", "truncated", "limited", "wrong"] as const) {
      it(`image2pipe ${codec} ${source} ${mode}`, async () => {
        const volume = new Volume();
        const stream = Buffer.concat(packets);
        const input = mode === "truncated" ? stream.subarray(0, stream.length - 1) : stream;
        volume.writeFileSync("/stream.bin", input);
        let stderr = "";
        const result = await createFfmpegCommand({ limits: mode === "limited" ? { maxFrames: 1 } : undefined }).execute({
          args: ["-y", "-v", "error", "-f", "image2pipe",
            ...(mode === "auto" ? [] : ["-c:v", mode === "wrong" ? codec === "png" ? "ppm" : "png" : codec]),
            "-framerate", "2", "-i", source,
            ...(mode === "trimmed" ? ["-ss", "0.5", "-t", "0.5"] : []),
            ...(mode === "default" ? [] : ["-c:v", mode === "copy" ? "copy" : "rawvideo"]), "-pix_fmt", "rgb24",
            "-f", mode === "copy" ? "image2pipe" : "rawvideo", "/out.bin"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {
            for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7);
          })(),
          stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (mode === "truncated" || mode === "limited" || mode === "wrong") {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes(mode === "limited" ? "maxFrames" : "image2pipe"), stderr);
          assert.equal(volume.existsSync("/out.bin"), false);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          // Native FFmpeg 7.0.2 output for these exact encoded packets.
          const expected = codec === "pgm" ? [[76, 76, 76], [29, 29, 29]]
            : codec === "mjpeg" ? [[254, 0, 0], [0, 0, 254]] : colors;
          assert.deepEqual(volume.readFileSync("/out.bin"), mode === "copy" ? stream
            : Buffer.from((mode === "trimmed" ? expected.slice(1) : expected).flatMap(color => Array.from({ length: 4 }, () => color).flat())));
        }
      });
    }
  }
}
