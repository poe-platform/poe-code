import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg output for six gray frames at 5 fps, read in frame-number order.
const source = [20, 40, 60, 80, 100, 120];
const film = source.flatMap((value, i) => Array<number>(i === 2 ? 4 : 5).fill(value));
for (const [expression, expected] of [
  ["5/2", [20, 60, 100]],
  ["2.5", [20, 60, 100]],
  ["1+2", [20, 60, 100, 120]],
  ["source_fps", source],
  ["source_fps/2", [20, 60, 100]],
  ["film", film],
  ["ntsc", source.flatMap(value => Array<number>(6).fill(value))],
  ["pal", source.flatMap(value => Array<number>(5).fill(value))],
  ["ntsc_film", film]
] as const) {
  it(`evaluates the complete fps expression ${expression}`, async () => {
    const volume = Volume.fromJSON({});
    source.forEach((value, i) => volume.writeFileSync(`/in${i + 1}.png`, encodeImage({
      width: 1, height: 1, channels: 4, data: new Uint8Array([value, value, value, 255]),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", "5", "-i", "/in%d.png", "-vf", `fps=${expression}`, "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(volume.readdirSync("/").length, source.length + expected.length);
    assert.deepEqual(expected.map((_, i) =>
      decodeImage(volume.readFileSync(`/out${i + 1}.png`) as Buffer).data[0]
    ), expected);
  });
}
