import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const options of [
  "1:1:6:6:red:1+1",
  "1:1:6:6:red:w/3",
  "1:1:6:6:red:2",
  "x=1:y=1:w=6:h=6:color=red:t=h/3",
  "x=1:y=1:width=6:height=6:color=red:thickness=w/3"
]) {
  it(`drawbox=${options} draws a two-pixel border across three RGBA frames`, async () => {
    const data = new Uint8Array(Array.from({ length: 64 }, () => [20, 40, 60, 80]).flat());
    const input = encodeImage({
      width: 8, height: 8, channels: 4, data,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    for (let frame = 1; frame <= 3; frame++) volume.writeFileSync(`/in${frame}.png`, input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=${options}`, "-frames:v", "3", "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    // Native FFmpeg produces 32 red pixels, retaining the original alpha.
    const expected = data.slice();
    for (let y = 1; y <= 6; y++) {
      for (let x = 1; x <= 6; x++) {
        if (x <= 2 || x >= 5 || y <= 2 || y >= 5) expected.set([255, 0, 0, 80], (y * 8 + x) * 4);
      }
    }
    for (let frame = 1; frame <= 3; frame++) {
      const output = decodeImage(volume.readFileSync(`/out${frame}.png`) as Buffer);
      assert.equal(output.width, 8);
      assert.equal(output.height, 8);
      assert.deepEqual(output.data, expected);
    }
  });
}
