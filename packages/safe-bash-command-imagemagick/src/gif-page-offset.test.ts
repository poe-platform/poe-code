import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it.each([
    ["12x9-1+2", -1, 2],
    ["12x9+2-3", 2, -3],
    ["12x9-1-3", -1, -3],
    ["12x9+4+3", 4, 3]
  ] as const)(`serializes page %s without wrapping GIF offsets (retained=${retained})`, async (page, x, y) => {
    const data = Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(value => [value, value, value, 255]));
    const input = await sharp(data, { raw: { width: 3, height: 2, channels: 4 } }).gif().toBuffer();
    const files = new Map([["/in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    for (const format of ["gif", "png"]) {
      const output = `/out.${format}`;
      expect(await runMagickCli(["/in.gif", "-repage", page, output], backend)).toMatchObject({ exitCode: 0 });
      const image = decodeImage(retained ? await filesystem.readFile(output) : files.get(output)!, { coalesce: false });
      expect(image).toMatchObject({ width: 3, height: 2, virtualCanvas: { width: 12, height: 9, x: format === "gif" ? Math.max(0, x) : x, y: format === "gif" ? Math.max(0, y) : y } });
      expect(image.data).toEqual(data);
    }
    expect(await runMagickCli(["/in.gif", "-repage", "12x9+4+3", "-crop", "1x1+0+0", "/miss.gif"], backend)).toMatchObject({ exitCode: 0 });
    const missed = decodeImage(retained ? await filesystem.readFile("/miss.gif") : files.get("/miss.gif")!, { coalesce: false });
    expect(missed).toMatchObject({ width: 1, height: 1, virtualCanvas: { width: 12, height: 9, x: 0, y: 0 } });
    expect(missed.data[3]).toBe(0);
  });
}
