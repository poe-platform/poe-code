import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference headers and samples from RGB48 big-endian input.
for (const [format, maximum, raster] of [
  ["gray", 255, "005aabff"],
  ["gray16be", 65535, "00205a06aadcfff8"]
] as const) {
  for (const target of ["pipe:1", "/out.pgm", "/out%d.pgm"]) {
    it(`encodes exact ${format} PGM samples to ${target}`, async () => {
      const input = Buffer.alloc(24);
      [0, 1, 257, 258, 32767, 32768, 33001, 45032, 65279, 65533, 65534, 65535]
        .forEach((value, index) => input.writeUInt16BE(value, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb48be", "-video_size", "2x2",
          "-i", "/in.raw", "-frames:v", "1", "-c:v", "pgm", "-pix_fmt", format,
          "-f", target === "pipe:1" ? "image2pipe" : "image2", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(target === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(target.replace("%d", "1")),
        Buffer.concat([Buffer.from(`P5\n2 2\n${maximum}\n`), Buffer.from(raster, "hex")]));
    });
  }
}
