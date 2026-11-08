import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const rate of [2, 4]) for (const axis of ["x", "y"]) for (const shifted of [false, true]) {
  it(`evaluates crop ${axis} using presentation time at ${rate} fps, shifted=${shifted}`, async () => {
    const input = encodeImage({
      width: 7, height: 5, channels: 4,
      data: new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat()),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    for (let frame = 1; frame <= 3; frame++) volume.writeFileSync(`/in${frame}.png`, input);
    const errors: Uint8Array[] = [];
    const position = axis === "x" ? "2*t:0" : "x=0:y=2*t";
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", String(rate), "-i", "/in%d.png", "-vf",
        `${shifted ? "setpts=PTS+0.5," : ""}crop=4:2:${position}`,
        "-fps_mode", "passthrough", "-frames:v", "3", "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const positions = shifted ? (rate === 2 ? [1, 2, 3] : [1, 2, 2]) : (rate === 2 ? [0, 1, 2] : [0, 0, 1]);
    for (const [index, position] of positions.entries()) {
      const output = decodeImage(new Uint8Array(volume.readFileSync(`/out${index + 1}.png`) as Uint8Array));
      assert.equal(output.width, 4);
      assert.equal(output.height, 2);
      const offset = position * (axis === "x" ? 1 : 7);
      assert.deepEqual(output.data, new Uint8Array(Array.from({ length: 8 }, (_, pixel) => {
        const gray = 1 + offset + Math.floor(pixel / 4) * 7 + pixel % 4;
        return [gray, gray, gray, 255];
      }).flat()));
    }
  });
}
