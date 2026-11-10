import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
for (const retained of [false, true]) {
  for (const [width, height] of [[17, 13], [1, 1], [1, 9], [9, 1], [2051, 3]] as const) {
    it(`writes independently decodable Adam7 pixels (${width}x${height}, retained=${retained})`, async () => {
      const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * [1, 7, 11][i % 4]!) % 251);
      const source = encodeImage({ width: width, height: height, data: pixels, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar", density: 72 }, { format: "png" }).data;
      const files = new Map([["/in.png", source]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.png", source);
      const result = await runConvertCli(["/in.png", "-interlace", "PNG", "-write", "/interlaced.png", "-interlace", "None", "-write", "/plain.png", "-interlace", "png", "/final.png"], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      for (const name of ["interlaced", "plain", "final"]) {
        const bytes = retained ? await fs.readFile(`/${name}.png`) : files.get(`/${name}.png`)!;
        expect(bytes[28]).toBe(name === "plain" ? 0 : 1);
        const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
        expect(new Uint8Array(decoded)).toEqual(pixels);
      }
    });
  }
}
