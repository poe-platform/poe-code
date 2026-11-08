import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const selection of ["", ":si=0", ":stream_index=0", ":si=-1", ":si=1", ":stream_index=1"]) {
  it(`validates subtitle burn-in stream availability (${selection || "automatic"}) before writing`, async () => {
    const pixels = new Uint8Array(320 * 180 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const png = (width: number, height: number, data: Uint8Array) => encodeImage({
      width, height, channels: 4, data, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const input = png(320, 180, pixels);
    const sentinel = png(1, 1, new Uint8Array([255, 0, 0, 255]));
    const volume = Volume.fromJSON({ "/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nTEST\n" });
    for (let i = 1; i <= 3; i++) volume.writeFileSync(`/in${i}.png`, input);
    volume.writeFileSync("/out1.png", sentinel);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "1", "-i", "/in%d.png", "-vf", `subtitles=/a.srt${selection}`, "-frames:v", "3", "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (selection.endsWith("=1")) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.match(stderr, /Unable to locate subtitle stream/);
      const preserved = decodeImage(volume.readFileSync("/out1.png") as Buffer);
      assert.equal(preserved.width, 1);
      assert.equal(preserved.height, 1);
      assert.deepEqual(preserved.data, new Uint8Array([255, 0, 0, 255]));
      assert.equal(volume.existsSync("/out2.png"), false);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      for (let i = 1; i <= 3; i++) {
        const frame = decodeImage(volume.readFileSync(`/out${i}.png`) as Buffer);
        assert.equal(frame.width, 320);
        assert.equal(frame.height, 180);
        if (i === 2) assert.notDeepEqual(frame.data, pixels);
        else assert.deepEqual(frame.data, pixels);
      }
    }
  });
}
