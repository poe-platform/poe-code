import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const chain of [
  "subtitles=/a.srt,subtitles=/b.srt",
  "subtitles=filename='/a.srt',subtitles=filename='/b.srt'",
  "subtitles@first=f=/a.srt,subtitles@second=f=/b.srt"
]) {
  it(`loads each subtitle filter's own cues: ${chain}`, async () => {
    const first = await run("subtitles=/a.srt");
    const second = await run("subtitles=/b.srt");
    const combined = await run(chain);
    for (const result of [first, second, combined]) assert.equal(result.result.exitCode, 0, result.stderr);
    for (let frame = 1; frame <= 3; frame++) {
      const actual = decodeImage(combined.volume.readFileSync(`/out${frame}.png`) as Buffer);
      const expected = decodeImage((frame === 3 ? second : first).volume.readFileSync(`/out${frame}.png`) as Buffer);
      assert.equal(actual.width, 320);
      assert.equal(actual.height, 180);
      assert.deepEqual(actual.data, expected.data, `frame ${frame}`);
      if (frame > 1) assert.notDeepEqual(actual.data, combined.pixels);
      else assert.deepEqual(actual.data, combined.pixels);
    }
  });
}

async function run(chain: string) {
  const pixels = new Uint8Array(320 * 180 * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const png = (width: number, height: number, data: Uint8Array) => encodeImage({
    width, height, data, channels: 4, format: "png", space: "srgb",
    depth: "uchar", density: 72, hasAlpha: true
  }, { format: "png" }).data;
  const input = png(320, 180, pixels);
  const volume = Volume.fromJSON({ "/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nTEST\n", "/b.srt": "1\n00:00:02,000 --> 00:00:03,000\nNEXT\n" });
  for (let frame = 1; frame <= 3; frame++) volume.writeFileSync(`/in${frame}.png`, input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-framerate", "1", "-i", "/in%d.png", "-vf",
      chain, "-frames:v", "3", "/out%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr, pixels };
}
