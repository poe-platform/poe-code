import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [mode, pattern, names, succeeds] of [
  ["glob", "f[ab].png", ["fa.png", "fb.png"], false],
  ["glob", "f?.png", ["fa.png", "fb.png"], true],
  ["glob", "f*.png", ["fa.png", "fb.png"], true],
  ["none", "foo.png", ["foo.png"], false],
  ["none", "f%02d.png", ["f%02d.png"], true]
] as const) {
  for (const forced of [false, true]) it(`image demuxer ${forced ? "forced" : "automatic"}: ${mode} ${pattern}`, async () => {
    const volume = new Volume();
    names.forEach((name, i) => volume.writeFileSync(`/${name}`, encodeImage({
      width: 2, height: 2, channels: 4,
      data: Uint8Array.from({ length: 16 }, (_, channel) => [(i + 1) * 40, 0, 0, 255][channel % 4]!),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data));
    const pixels: number[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: [...(forced ? ["-f", "image2"] : []), "-pattern_type", mode, "-i", pattern, "/out%02d.png"],
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
    const stderr = Buffer.concat(errors).toString();
    if (forced || succeeds) {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(pixels, names.map((_, i) => (i + 1) * 40));
    } else {
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(pixels, []);
      if (mode === "none") assert.ok(stderr.includes("Option pattern_type not found"), stderr);
    }
  });
}
