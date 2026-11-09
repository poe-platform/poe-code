import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it.each([
    [2, 1, 0, 0],
    [2, 1, 3, 2],
    [2, 9, 0, 0],
    [12, 1, 0, 0],
    [12, 9, 23, 19]
  ])(`keeps the GIF screen at least as large as the raster for %ix%i+%i+%i (retained=${retained})`, async (width, height, x, y) => {
    const data = Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(value => [value, value, value, 255]));
    const input = await sharp(data, { raw: { width: 3, height: 2, channels: 4 } }).gif().toBuffer();
    const files = new Map([["/in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli(["/in.gif", "-repage", "12x9+4+3", "/page.gif"], backend)).toMatchObject({ exitCode: 0 });
    for (const format of ["gif", "png"]) {
      const output = `/out.${format}`;
      expect(await runMagickCli(["/page.gif", "-repage", `${width}x${height}+${x}+${y}`, output], backend)).toMatchObject({ exitCode: 0 });
      const image = decodeImage(retained ? await filesystem.readFile(output) : files.get(output)!, { coalesce: false });
      expect(image).toMatchObject({
        width: 3, height: 2,
        virtualCanvas: { width: format === "gif" ? Math.max(3, width) : width, height: format === "gif" ? Math.max(2, height) : height, x, y }
      });
      expect(image.data).toEqual(data);
    }
  });
}
