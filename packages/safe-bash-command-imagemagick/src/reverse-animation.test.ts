import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const reverse of [false, true]) {
    it(`keeps GIF delays with frames (retained=${retained}, reverse=${reverse})`, async () => {
      const pixels = new Uint8Array(3 * 3 * 2 * 4);
      for (let i = 0; i < 18; i++) pixels.set(i < 9 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
      const input = await sharp(pixels, { raw: { width: 3, height: 6, channels: 4 } })
        .gif({ pageHeight: 3, delay: [100, 200], loop: 0 }).toBuffer();
      const files = new Map([["in.gif", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/in.gif", input);
      expect(await runConvertCli(["in.gif", ...(reverse ? ["-reverse"] : []), "out.gif"],
        retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
      const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
      expect(await sharp(output, { animated: true }).metadata()).toMatchObject({
        width: 3, pages: 2, pageHeight: 3, delay: reverse ? [200, 100] : [100, 200], loop: 0
      });
      for (let page = 0; page < 2; page++) {
        expect([...decodeImage(output, { page }).data.slice(0, 4)])
          .toEqual((page === 0) !== reverse ? [255, 0, 0, 255] : [0, 0, 255, 255]);
      }
    });
  }
}
