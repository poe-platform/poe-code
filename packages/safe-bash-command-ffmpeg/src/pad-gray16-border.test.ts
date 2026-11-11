import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 border samples, before any output pixel-format conversion.
for (const [color, gray16, gray8] of [
  ["red", 0x4c8b, 76],
  ["black", 0, 0],
  ["white", 65535, 255],
  ["lime", 38469, 150],
  ["blue", 7471, 29]
] as const) {
  for (const format of ["gray16be", "gray16le", "gray"]) {
    for (const graph of [false, true]) {
      it(`writes native ${format} ${color} pad borders (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from(format === "gray" ? [13] : [13, 20]) });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const filter = `pad=2:1:0:0:${color}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", format, "-s", "1x1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
            "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const bytes = Buffer.concat(output);
        assert.equal(bytes.length, format === "gray" ? 2 : 4);
        // Only assert generated samples: input preservation is a separate concern.
        assert.equal(format === "gray" ? bytes[1]
          : format === "gray16le" ? bytes.readUInt16LE(2) : bytes.readUInt16BE(2),
        format === "gray" ? gray8 : gray16);
      });
    }
  }
}
