import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 headers and raster bytes for the issue's RGB48 fixture.
for (const [format, maxval, raster] of [
  ["rgba", 255, "000001ff018080ff81b0ffffffffffff"],
  ["rgba64be", 65535, "000000010101ffff01027fff8000ffff80e9afe8fefffffffffdfffeffffffff"]
] as const) {
  for (const target of ["pipe:1", "/out.pam", "/frame%d.pam"]) {
    it(`encodes native PAM ${format} to ${target}`, async () => {
      const input = Buffer.alloc(24);
      [0, 1, 257, 258, 32767, 32768, 33001, 45032, 65279, 65533, 65534, 65535]
        .forEach((value, index) => input.writeUInt16BE(value, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb48be", "-video_size", "2x2",
          "-i", "/in.raw", "-frames:v", "1", "-c:v", "pam", "-pix_fmt", format,
          "-f", target.includes("%") ? "image2" : "image2pipe", target],
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
      const actual = target === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(target.replace("%d", "1"));
      assert.deepEqual(actual, Buffer.concat([
        Buffer.from(`P7\nWIDTH 2\nHEIGHT 2\nDEPTH 4\nMAXVAL ${maxval}\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),
        Buffer.from(raster, "hex")
      ]));
    });
  }
}
