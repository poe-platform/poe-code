import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const text = "1\n00:00:01,000 --> 00:00:02,000\nHELLO\n";
const utf16le = Buffer.from("\ufeff" + text, "utf16le");
for (const [encoding, captions] of [
  ["UTF-8", Buffer.from(text)],
  ["UTF-8 BOM", Buffer.from("\ufeff" + text)],
  ["UTF-16LE BOM", utf16le],
  ["UTF-16BE BOM", Buffer.from(utf16le).swap16()]
] as const) {
  it(`burns ${encoding} SubRip captions only during the cue`, async () => {
    const width = 256, height = 144;
    const data = new Uint8Array(width * height * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const input = encodeImage({ width, height, channels: 4, data, format: "png",
      space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const volume = Volume.fromJSON({
      "/in1.png": Buffer.from(input), "/in2.png": Buffer.from(input), "/in3.png": Buffer.from(input),
      "/captions.srt": captions
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", "1", "-i", "/in%d.png", "-vf", "subtitles=/captions.srt",
        "-frames:v", "3", "/out%d.png"],
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
    for (const frame of [1, 2, 3]) {
      const output = decodeImage(volume.readFileSync(`/out${frame}.png`) as Buffer);
      assert.equal(output.width, width);
      assert.equal(output.height, height);
      const visible = output.data.some((value, index) => index % 4 !== 3 && value > 0);
      assert.equal(visible, frame === 2, `frame ${frame} caption visibility`);
    }
  });
}
