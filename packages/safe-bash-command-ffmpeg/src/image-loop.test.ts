import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const count of [1, 2]) {
  for (const [loop, limit, expected] of [
    ["1", ["-frames:v", "5"], 5],
    ["1", ["-t", "0.2"], 5],
    ["0", ["-frames:v", "5"], count],
    ["1", ["-frames:v", "0"], 0],
    ["1", ["-to", "0.2"], 5],
    ["1", [], -1]
  ] as const) {
    it(`loops ${count} image(s) with -loop ${loop} ${limit.join(" ")}`, async () => {
      const volume = new Volume();
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255]];
      for (let i = 0; i < count; i++) {
        volume.writeFileSync(`/f0${i}.png`, encodeImage({
          width: 16, height: 16, channels: 4,
          data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, channel) => colors[i]![channel % 4]!),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data);
      }
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-loop", loop, "-i", count === 1 ? "/f00.png" : "/f%02d.png", ...limit, "/out%02d.png"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      if (expected === -1) {
        assert.notEqual(result.exitCode, 0);
        assert.match(Buffer.concat(errors).toString(), /requires a finite frame count or duration/);
        return;
      }
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(volume.readdirSync("/").filter(name => String(name).startsWith("out")),
        Array.from({ length: expected }, (_, i) => `out0${i + 1}.png`));
      for (let i = 0; i < expected; i++) {
        assert.deepEqual([...decodeImage(volume.readFileSync(`/out0${i + 1}.png`) as Buffer).data.slice(0, 4)], colors[i % count]);
      }
    });
  }
}
