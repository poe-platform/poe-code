import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [mode, pattern, names] of [
  ["1", "/f*.png", ["fa.png", "fb.png"]],
  ["2", "/f%d.png", ["f0.png", "f1.png"]],
  ["3", "/f%d.png", ["f%d.png"]]
] as const) {
  it(`image2 accepts numeric pattern_type ${mode}`, async () => {
    const volume = new Volume();
    names.forEach((name, i) => volume.writeFileSync(`/${name}`, encodeImage({
      width: 2, height: 2, channels: 4,
      data: Uint8Array.from({ length: 16 }, (_, channel) => [(i + 1) * 40, 0, 0, 255][channel % 4]!),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-f", "image2", "-pattern_type", mode, "-i", pattern, "/out%02d.png"],
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
    const outputs = volume.readdirSync("/").filter(name => String(name).startsWith("out")).sort();
    assert.deepEqual(outputs, names.map((_, i) => `out0${i + 1}.png`));
    const pixels = outputs.map(name => decodeImage(volume.readFileSync(`/${name}`) as Buffer).data[0]);
    assert.deepEqual(pixels, names.map((_, i) => (i + 1) * 40));
  });
}
