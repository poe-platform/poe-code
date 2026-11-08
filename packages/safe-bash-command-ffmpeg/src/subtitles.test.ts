import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const option of ["typo=1", "alpha=bogus", "alpha=2", "alpha=", "alpha=-1", "::bogus", ":::::::0:extra"]) {
  it(`subtitles rejects ${option} before replacing output frames`, async () => {
    const { volume, result, stderr, sentinel } = await run(option);
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes("subtitles"), stderr);
    const output = decodeImage(volume.readFileSync("/out1.png") as Buffer);
    assert.equal(output.width, 1);
    assert.equal(output.height, 1);
    assert.deepEqual(output.data, sentinel);
    assert.equal(volume.existsSync("/out2.png"), false);
    assert.equal(volume.existsSync("/out3.png"), false);
  });
}

for (const option of ["", "alpha=0", "alpha=false", "alpha=1", "alpha=true"]) {
  it(`subtitles accepts ${option || "default options"} and renders the active frame`, async () => {
    const { volume, result, stderr, pixels } = await run(option);
    assert.equal(result.exitCode, 0, stderr);
    for (let frame = 1; frame <= 3; frame++) {
      const output = decodeImage(volume.readFileSync(`/out${frame}.png`) as Buffer);
      assert.equal(output.width, 320);
      assert.equal(output.height, 180);
      if (frame === 2) assert.notDeepEqual(output.data, pixels);
      else assert.deepEqual(output.data, pixels);
    }
  });
}

async function run(option: string) {
  const pixels = new Uint8Array(320 * 180 * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const sentinel = new Uint8Array([255, 0, 0, 255]);
  const png = (width: number, height: number, data: Uint8Array) => encodeImage({
    width, height, data, channels: 4, format: "png", space: "srgb",
    depth: "uchar", density: 72, hasAlpha: true
  }, { format: "png" }).data;
  const input = png(320, 180, pixels);
  const volume = Volume.fromJSON({ "/a.srt": "1\n00:00:01,000 --> 00:00:02,000\nTEST\n" });
  for (let frame = 1; frame <= 3; frame++) volume.writeFileSync(`/in${frame}.png`, input);
  volume.writeFileSync("/out1.png", png(1, 1, sentinel));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-framerate", "1", "-i", "/in%d.png", "-vf",
      `subtitles=/a.srt${option ? `:${option}` : ""}`, "-frames:v", "3", "/out%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr, pixels, sentinel };
}
