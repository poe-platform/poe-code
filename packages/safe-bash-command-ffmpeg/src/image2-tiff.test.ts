import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const width = 8;
const height = 4;
const rgb = Uint8Array.from({ length: width * height * 3 }, (_, i) =>
  (Math.floor(i / 3) % width * 23 + Math.floor(i / (width * 3)) * 41 + i % 3 * 53) % 256);
const rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : rgb[Math.floor(i / 4) * 3 + i % 4]!);

for (const codec of ["tiff", "png"]) {
  for (const target of ["pipe:1", "/out.bin"]) {
    it(`encodes lossless ${codec} from RGB raw video through image2pipe to ${target}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(rgb) });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "8x4",
          "-i", "/in.raw", "-frames:v", "1", "-c:v", codec, "-f", "image2pipe", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const bytes = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
      const image = decodeImage(bytes);
      assert.equal(image.format, codec);
      assert.equal(image.width, width);
      assert.equal(image.height, height);
      assert.deepEqual(image.data, rgba);
    });
  }
}

it("encodes TIFF through the synchronous numbered image output path", () => {
  const volume = Volume.fromJSON({ "/in.png": Buffer.from(encodeImage({
    width, height, data: rgba, channels: 4, format: "png", space: "srgb",
    depth: "uchar", density: 72, hasAlpha: false
  }, { format: "png" }).data) });
  const result = evalSyncFfmpeg(["-y", "-v", "error", "-i", "/in.png", "-c:v", "tiff",
    "-f", "image2", "/out%02d.bin"], undefined,
  path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
  (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
  assert.equal(result, "");
  const image = decodeImage(volume.readFileSync("/out01.bin") as Buffer);
  assert.equal(image.format, "tiff");
  assert.equal(image.width, width);
  assert.equal(image.height, height);
  assert.deepEqual(image.data, rgba);
});
