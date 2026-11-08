import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const alpha of [undefined, "0", "false", "no", "off", "1", "true", "yes", "on"]) {
  for (const mixed of [false, true]) {
    it(`subtitles alpha=${alpha ?? "default"} respects ${mixed ? "mixed" : "transparent"} input alpha`, async () => {
      const pixels = new Uint8Array(320 * 180 * 4);
      if (mixed) {
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = 32;
          pixels[i + 1] = 64;
          pixels[i + 2] = 96;
          pixels[i + 3] = (i / 4) % 256;
        }
      }
      const input = encodeImage({ width: 320, height: 180, channels: 4, data: pixels,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const volume = Volume.fromJSON({ "/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nTEST\n" });
      for (let i = 1; i <= 3; i++) volume.writeFileSync(`/in${i}.png`, input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-framerate", "1", "-i", "/in%d.png", "-vf",
          `subtitles=/a.srt${alpha === undefined ? "" : `:alpha=${alpha}`}`, "-frames:v", "3", "/out%d.png"],
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
      for (let i = 1; i <= 3; i++) {
        const frame = decodeImage(volume.readFileSync(`/out${i}.png`) as Buffer);
        assert.equal(frame.width, 320);
        assert.equal(frame.height, 180);
        if (i !== 2) {
          assert.deepEqual(frame.data, pixels, "inactive frames remain unchanged");
          continue;
        }
        assert.notDeepEqual(frame.data, pixels, "active subtitles change RGB pixels");
        const inputAlpha = pixels.filter((_, index) => index % 4 === 3);
        const outputAlpha = frame.data.filter((_, index) => index % 4 === 3);
        if (alpha !== undefined && ["1", "true", "yes", "on"].includes(alpha)) {
          assert.notDeepEqual(outputAlpha, inputAlpha, "enabled alpha processing changes alpha");
          assert.equal(outputAlpha[0], inputAlpha[0], "pixels outside subtitles remain unchanged");
        } else {
          assert.deepEqual(outputAlpha, inputAlpha, "disabled alpha processing preserves every alpha byte");
        }
      }
    });
  }
}
