import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Fixtures generated with native FFmpeg from the two SRT cues below:
// -i a.srt -i b.srt -map 0:s:0 -map 1:s:0 -c:s srt tracks.mkv
// -i a.srt -c:s mov_text subs.mp4
for (const [filename, selection, activeFrame] of [
  ["tracks.mkv", "", 2], ["tracks.mkv", ":si=0", 2],
  ["tracks.mkv", ":si=1", 3], ["tracks.mkv", ":stream_index=1", 3],
  ["subs.mp4", "", 2], ["subs.mp4", ":si=0", 2], ["a.srt", "", 2]
] as const) {
  it(`burns embedded text subtitles from ${filename}${selection}`, async () => {
    const pixels = new Uint8Array(320 * 180 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const png = (width: number, height: number, data: Uint8Array) => encodeImage({
      width, height, channels: 4, data, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const input = png(320, 180, pixels);
    const volume = Volume.fromJSON({ "/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nHELLO\n" });
    if (filename !== "a.srt") volume.writeFileSync(`/${filename}`,
      readFileSync(new URL(`./fixtures/embedded-subtitles/${filename}`, import.meta.url)));
    for (let i = 1; i <= 3; i++) volume.writeFileSync(`/in${i}.png`, input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "1", "-i", "/in%d.png", "-vf", `subtitles=/${filename}${selection}`, "-frames:v", "3", "/out%d.png"],
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
      assert.equal(frame.data.some((value, index) => index % 4 !== 3 && value > 0), i === activeFrame, `frame ${i}`);
    }
  });
}
