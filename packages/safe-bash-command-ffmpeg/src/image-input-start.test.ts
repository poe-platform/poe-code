import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [pattern, names] of [
  ["f%d.png", ["f-1.png", "f0.png", "f1.png"]],
  ["f%03d.png", ["f-001.png", "f000.png", "f001.png"]]
] as const) {
  for (const start of ["-1", "0", "bad", "-1.5", "-2147483649"]) {
    it(`image2 input ${pattern} with start_number ${start}`, async () => {
      const volume = new Volume();
      names.forEach((name, i) => volume.writeFileSync(`/${name}`, encodeImage({
        width: 2, height: 2, channels: 4,
        data: Uint8Array.from({ length: 16 }, (_, channel) => [(i + 1) * 40, 0, 0, 255][channel % 4]!),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-f", "image2", "-pattern_type", "sequence", "-start_number", start,
          "-i", pattern, "/out%02d.png"],
        cwd: "/", env: { LC_ALL: "C" }, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const expected = start === "-1" ? [40, 80, 120] : start === "0" ? [80, 120] : [];
      assert.equal(result.exitCode, expected.length ? 0 : 1, Buffer.concat(errors).toString());
      const outputs = volume.readdirSync("/").filter(name => String(name).startsWith("out"));
      assert.deepEqual(outputs, expected.map((_, i) => `out0${i + 1}.png`));
      assert.deepEqual(outputs.map(name => decodeImage(volume.readFileSync(`/${String(name)}`) as Buffer).data[0]), expected);
    });
  }
}
