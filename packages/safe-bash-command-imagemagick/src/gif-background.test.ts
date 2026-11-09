import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  for (const operation of ["-extent", "-splice"]) {
    it.each([false, true])(`uses GIF background for ${operation} (retained=${retained}, explicit=%s)`, async explicit => {
      const data = Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(value => [value, value, value, 255]));
      const input = await sharp(data, { raw: { width: 3, height: 2, channels: 4 } }).gif().toBuffer();
      const paletteSize = 1 << ((input[10]! & 7) + 1);
      const index = Array.from({ length: paletteSize }, (_, i) => i).find(i => input[13 + i * 3] === 40)!;
      expect(index).toBeDefined();
      input[11] = index;
      const files = new Map([["/in.gif", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", input);
      const result = await runMagickCli(["/in.gif", ...(explicit ? ["-background", "#505050"] : []), "+repage", operation, operation === "-extent" ? "5x3" : "1x1+0+0", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      const fill = explicit ? 80 : 40;
      const expected = operation === "-extent" ? [10, 20, 30, fill, fill, 40, 50, 60, fill, fill, fill, fill, fill, fill, fill] : [fill, fill, fill, fill, fill, 10, 20, 30, fill, 40, 50, 60];
      expect(Array.from(image.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
  }
}
