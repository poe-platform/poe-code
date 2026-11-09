import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const characters of [["\u{10000}", "\ue000"], ["b", "a"]]) {
  it(`image2 glob sorts UTF-8 bytes for ${JSON.stringify(characters)}`, async () => {
    const volume = new Volume();
    characters.forEach((character, i) => volume.writeFileSync(`/f${character}.png`, encodeImage({
      width: 2, height: 2, channels: 4,
      data: Uint8Array.from({ length: 16 }, (_, channel) => [i + 1, 0, 0, 255][channel % 4]!),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-f", "image2", "-pattern_type", "glob", "-i", "/f*.png", "/out%02d.png"],
      cwd: "/", env: { LC_ALL: "C" }, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) {
          volume.writeFileSync(path, bytes);
        },
        async stat(path: string) { return volume.statSync(path); },
        async readdir(path: string) { return volume.readdirSync(path, { withFileTypes: true }); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const pixels = [1, 2].map(index => decodeImage(volume.readFileSync(`/out0${index}.png`) as Buffer).data[0]);
    assert.deepEqual(pixels, [2, 1]);
  });
}
