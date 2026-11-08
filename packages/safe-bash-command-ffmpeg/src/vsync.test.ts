import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const value of ["42", "bad", "-2", "3", "1.5", "", "auto", "NaN", "Infinity",
  "-1", "0", "1", "2", "passthrough", "cfr", "vfr", "drop", "CFR"]) {
  const valid = ["-1", "0", "1", "2", "passthrough", "cfr", "vfr", "drop", "CFR"].includes(value);
  for (const beforeInput of [true, false]) {
    it(`-vsync ${JSON.stringify(value)} ${beforeInput ? "before" : "after"} input ${valid ? "writes frames" : "preserves all files"}`, async () => {
      const volume = new Volume();
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
      colors.forEach((color, index) => volume.writeFileSync(`/f${index}.png`, encodeImage({
        width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data));
      volume.writeFileSync("/o000.png", volume.readFileSync("/f2.png"));
      const before = volume.toJSON();
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", ...(beforeInput ? ["-vsync", value] : []),
          "-framerate", "2", "-i", "/f%d.png", ...(beforeInput ? [] : ["-vsync", value]),
          "-frame_pts", "1", "/o%03d.png"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!valid) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("vsync"), stderr);
        assert.deepEqual(volume.toJSON(), before);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readdirSync("/"), ["f0.png", "f1.png", "f2.png", "o000.png", "o001.png", "o002.png"]);
      colors.forEach((color, index) => {
        const image = decodeImage(volume.readFileSync(`/o00${index}.png`) as Buffer);
        assert.deepEqual([...image.data.slice(0, 4)], color);
      });
    });
  }
}
