import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 96 }, (_, i) =>
  (Math.floor(i / 3) % 8 * 23 + Math.floor(i / 24) * 41 + i % 3 * 53) % 256));

// Native FFmpeg 7.0.2: IHDR and decoded RGB bytes (16-bit samples use their high byte).
for (const [format, depth, color, hash] of [
  ["rgba", 8, 6, "b8ad252385d1754c4f04bd246470f148e294c69c3a167e4db9996ac255d6d390"],
  ["rgb48be", 16, 2, "5c71dbfb87c3fb43b436a0d941c130dd30324f48aec8aee9f4deb71c3dcb4495"],
  ["pal8", 8, 3, "27062e809a7b7cd9d76aa07b313a4b36a4a249b000c943d48d7240be04fc55e8"],
  ["monob", 1, 0, "d305198c2d7d188793888d8fce68f49d8494a131700adfad9c8518a61ac378a6"],
  ["rgb24", 8, 2, "b8ad252385d1754c4f04bd246470f148e294c69c3a167e4db9996ac255d6d390"]
] as const) {
  for (const target of ["pipe:1", "/out.png", "/out%02d.png"]) {
    for (const source of format === "rgb48be" ? ["rgb24", "rgb48be"] : ["rgb24"]) {
      it(`PNG ${source} -pix_fmt ${format} writes native storage and colors to ${target}`, async () => {
        const sourceBytes = source === "rgb24" ? input
          : Buffer.from([...input].flatMap(value => [value, 37]));
        const volume = Volume.fromJSON({ "/in.raw": sourceBytes });
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", source, "-video_size", "8x4",
            "-i", "/in.raw", "-frames:v", "1", "-c:v", "png", "-pix_fmt", format,
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
        const png = target === "pipe:1" ? Buffer.concat(chunks)
          : volume.readFileSync(target.includes("%") ? "/out01.png" : target) as Buffer;
        assert.deepEqual([...png.subarray(24, 26)], [depth, color]);
        const decoded = decodeImage(png);
        assert.equal(decoded.width, 8);
        assert.equal(decoded.height, 4);
        const rgb = decoded.data16
          ? Uint8Array.from(decoded.data16, sample => sample >> 8).filter((_, i) => i % 4 !== 3)
          : decoded.data.filter((_, i) => i % 4 !== 3);
        if (source === "rgb48be") {
          assert.deepEqual(rgb, new Uint8Array(input));
          assert.deepEqual(decoded.data16, Uint16Array.from(Array.from({ length: 128 }, (_, i) =>
            i % 4 === 3 ? 65535 : input[Math.floor(i / 4) * 3 + i % 4]! * 256 + 37)));
        } else assert.equal(createHash("sha256").update(rgb).digest("hex"), hash);
      });
    }
  }
}
