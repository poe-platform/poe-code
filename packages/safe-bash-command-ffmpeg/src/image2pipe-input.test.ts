import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
const images = colors.map(color => encodeImage({
  width: 4, height: 4, channels: 4,
  data: Uint8Array.from({ length: 64 }, (_, i) => color[i % 4]!),
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data);
const stream = Buffer.concat(images);

for (const source of ["/stream.bin", "pipe:0"]) {
  for (const scenario of ["all", "trimmed", "truncated", "invalid", "limited"] as const) {
    it(`decodes image2pipe ${source}: ${scenario}`, async () => {
      const volume = new Volume();
      const input = scenario === "truncated" ? stream.subarray(0, stream.length - 1)
        : scenario === "invalid" ? Buffer.concat([stream, Buffer.from("junk")]) : stream;
      volume.writeFileSync("/stream.bin", input);
      let stderr = "";
      const result = await createFfmpegCommand({ limits: scenario === "limited" ? { maxFrames: 1 } : undefined }).execute({
        args: ["-y", "-v", "error", "-f", "image2pipe", "-c:v", "png",
          ...(scenario === "trimmed" ? ["-framerate", "2"] : []), "-i", source,
          ...(scenario === "trimmed" ? ["-ss", "0.5", "-t", "0.5"] : []), "/f%d.png"],
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
      if (["truncated", "invalid", "limited"].includes(scenario)) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes(scenario === "limited" ? "maxFrames" : "image2pipe"), stderr);
        assert.deepEqual(volume.readdirSync("/"), ["stream.bin"]);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const expected = scenario === "trimmed" ? colors.slice(1) : colors;
      assert.deepEqual(volume.readdirSync("/"), [...expected.map((_, i) => `f${i + 1}.png`), "stream.bin"]);
      expected.forEach((color, i) => {
        const image = decodeImage(volume.readFileSync(`/f${i + 1}.png`) as Buffer);
        assert.equal(image.width, 4);
        assert.equal(image.height, 4);
        assert.deepEqual(image.data, Uint8Array.from({ length: 64 }, (_, n) => color[n % 4]!));
      });
    });
  }
}
