import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
const images = colors.map(color => encodeImage({
  width: 16, height: 16, channels: 4,
  data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => color[i % 4]!),
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data);
const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;

for (const fps of [25, 2]) {
  for (const [range, expected] of [
    [[], colors],
    [["-t", String(2 / fps)], colors.slice(0, 2)],
    [["-ss", String(1 / fps)], colors.slice(1)],
    [["-ss", String(1 / fps), "-t", String(1 / fps)], colors.slice(1, 2)]
  ] as const) {
    it(`image sequence at ${fps} fps retains colors for ${range.join(" ") || "untrimmed output"}`, async t => {
      const volume = new Volume();
      images.forEach((bytes, i) => volume.writeFileSync(`/f0${i}.png`, bytes));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: [...(fps === 25 ? [] : ["-framerate", String(fps)]), "-i", "/f%02d.png", ...range, "/o%02d.png"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const names = expected.map((_, i) => `o0${i + 1}.png`);
      assert.deepEqual(volume.readdirSync("/"), ["f00.png", "f01.png", "f02.png", ...names]);
      const pixels = names.map(name => [...decodeImage(volume.readFileSync(`/${name}`) as Buffer).data.slice(0, 4)]);
      assert.deepEqual(pixels, expected);
      await t.test("matches native FFmpeg frame boundaries and RGBA colors", { skip: !nativeAvailable }, () => {
        const native = spawnSync("ffmpeg", ["-v", "error", "-framerate", String(fps),
          "-f", "image2pipe", "-i", "pipe:0", ...range, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
        ], { input: Buffer.concat(images) });
        assert.equal(native.status, 0, native.stderr.toString());
        assert.equal(native.stdout.length, pixels.length * 16 * 16 * 4);
        assert.deepEqual(pixels, pixels.map((_, i) => [...native.stdout.subarray(i * 1024, i * 1024 + 4)]));
      });
    });
  }
}
