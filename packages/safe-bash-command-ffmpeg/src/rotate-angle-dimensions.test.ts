import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const cropped of [false, true]) {
  for (const variable of ["iw", "in_w", "ih", "in_h"]) {
    for (const option of ["", "angle=", "a="]) {
      it(`resolves rotate ${option}PI/${variable} from the input frame (cropped=${cropped})`, async () => {
        const input = encodeImage({
          width: 9, height: 5, channels: 4,
          data: Uint8Array.from(Array.from({ length: 45 }, (_, i) => [i * 5, i * 3, 255 - i * 4, 255]).flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const volume = Volume.fromJSON({ "/in.png": Buffer.from(input) });
        const width = cropped ? 7 : 9;
        const height = cropped ? 3 : 5;
        const dimension = variable === "iw" || variable === "in_w" ? width : height;
        for (const [angle, output] of [[`PI/${dimension}`, "/expected.png"], [`PI/${variable}`, "/actual.png"]]) {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-y", "-i", "/in.png", "-vf",
              `${cropped ? "crop=7:3:1:1," : ""}rotate=${option}${angle}`, "-frames:v", "1", output],
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
        }
        const expected = decodeImage(volume.readFileSync("/expected.png") as Buffer);
        const actual = decodeImage(volume.readFileSync("/actual.png") as Buffer);
        assert.deepEqual([actual.width, actual.height], [width, height]);
        assert.deepEqual(actual.data, expected.data);
      });
    }
  }
}
