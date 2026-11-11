import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it.each([false, true])(`uses the first TIFF frame for the GIF screen (roll=%s, retained=${retained})`, async roll => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const backend = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli([
      "-size", "3x2", "xc:red", "-size", "4x3", "xc:blue", "-size", "2x1", "xc:lime", "/in.tiff"
    ], backend)).toMatchObject({ exitCode: 0 });
    expect(await runMagickCli(["/in.tiff", ...(roll ? ["-roll", "+1+1"] : []), "/out.gif"], backend)).toMatchObject({ exitCode: 0 });
    const bytes = retained ? await filesystem.readFile("/out.gif") : files.get("/out.gif")!;
    expect([...bytes.subarray(6, 10)]).toEqual([3, 0, 2, 0]);
    for (const [page, [width, height]] of [[3, 2], [4, 3], [2, 1]].entries()) {
      expect(decodeImage(bytes, { page, coalesce: false })).toMatchObject({ width, height });
      expect(decodeImage(bytes, { page })).toMatchObject({ width: 3, height: 2 });
    }
  });

  it.each([
    ["3x2", "4x3", undefined, 3, 2],
    ["4x3", "3x2", undefined, 4, 3],
    ["3x2", "4x3", "8x7", 8, 7],
    ["3x2", "4x3", "1x1", 3, 2]
  ] as const)(`sizes animated GIFs from the first frame (%s, %s, page=%s, retained=${retained})`, async (first, second, page, width, height) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const backend = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli([
      "-size", first, "xc:red", "-size", second, "xc:blue",
      ...(page ? ["-repage", page] : []), "/out.gif"
    ], backend)).toMatchObject({ exitCode: 0 });
    const bytes = retained ? await filesystem.readFile("/out.gif") : files.get("/out.gif")!;
    expect([...bytes.subarray(6, 10)]).toEqual([width, 0, height, 0]);
    for (const [index, size] of [first, second].entries()) {
      const [frameWidth, frameHeight] = size.split("x").map(Number);
      const frame = decodeImage(bytes, { page: index, coalesce: false });
      expect(frame).toMatchObject({ width: frameWidth, height: frameHeight, virtualCanvas: { width, height } });
      expect(frame.data).toEqual(Uint8Array.from(Array.from({ length: frameWidth! * frameHeight! }, () => index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat()));
      expect(decodeImage(bytes, { page: index })).toMatchObject({ width, height });
    }
  });

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
