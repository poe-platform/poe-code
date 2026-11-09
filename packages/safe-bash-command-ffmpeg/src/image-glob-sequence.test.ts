import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [mode, pattern, names] of [
  ["glob_sequence", "f%*.png", ["fa.png", "fb.png"]],
  [undefined, "f%*.png", ["fa.png", "fb.png"]],
  ["glob_sequence", "f%d.png", ["f0.png", "f1.png"]],
  ["glob", "f%*.png", ["f%a.png", "f%b.png"]],
  ["none", "f%*.png", ["f%*.png"]],
  ["sequence", "f%*.png", ["f%*.png"]],
  ["glob_sequence", "f%?.png", ["fa.png", "fb.png"]],
  ["glob_sequence", "f%[ab%].png", ["fa.png", "fb.png"]],
  ["glob_sequence", "f%{b,a%}.png", ["fb.png", "fa.png"]],
  ["glob_sequence", "f*%?.png", ["f*a.png", "f*b.png"]],
  ["glob_sequence", "f\\%?.png", ["f\\a.png", "f\\b.png"]],
  ["glob_sequence", "f%%%*.png", ["f%a.png", "f%b.png"]]
] as const) {
  it(`image2 ${mode ?? "default"} resolves ${pattern}`, async () => {
    const volume = new Volume();
    names.forEach((name, i) => volume.writeFileSync(`/${name}`, encodeImage({
      width: 2, height: 2, channels: 4,
      data: Uint8Array.from({ length: 16 }, (_, channel) => [(i + 1) * 40, 0, 0, 255][channel % 4]!),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data));
    const pixels: number[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-f", "image2", ...(mode ? ["-pattern_type", mode] : []), "-i", pattern, "/out%02d.png"],
      cwd: "/", env: { LC_ALL: "C" }, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) {
          pixels.push(decodeImage(bytes).data[0]!);
          volume.writeFileSync(path, bytes);
        },
        async stat(path: string) { return volume.statSync(path); },
        async readdir(path: string) { return volume.readdirSync(path, { withFileTypes: true }); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(pixels, names.map((_, i) => (i + 1) * 40));
  });
}
