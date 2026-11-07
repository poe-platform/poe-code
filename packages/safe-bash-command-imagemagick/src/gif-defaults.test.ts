import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it.each([undefined, 0, 24])(`matches native GIF defaults for PNG frames (retained=${retained}, delay=%s)`, async delay => {
    const pixels = [
      new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0]),
      new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255])
    ];
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    for (const [index, data] of pixels.entries()) {
      const bytes = await sharp(data, { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
      files.set(`${index}.png`, bytes);
      await filesystem.writeFile(`/${index}.png`, bytes);
    }
    const backend = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli([...(delay === undefined ? [] : ["-delay", String(delay)]), "0.png", "1.png", "out.gif"], backend))
      .toMatchObject({ exitCode: 0 });
    // Native ImageMagick writes zero delay and Undefined disposal unless requested.
    for (const name of ["out.gif", "rewrite.gif"]) {
      if (name === "rewrite.gif") expect(await runMagickCli(["out.gif", name], backend)).toMatchObject({ exitCode: 0 });
      const bytes = retained ? await filesystem.readFile(`/${name}`) : files.get(name)!;
      expect(decodeImage(bytes, { animated: true }).delay).toEqual([(delay ?? 0) * 10, (delay ?? 0) * 10]);
      for (let page = 0; page < 2; page++) {
        const frame = decodeImage(bytes, { page, coalesce: false });
        expect(frame).toMatchObject({ width: 3, height: 1, disposal: 0 });
        expect(frame.data).toEqual(new Uint8Array(Array.from({ length: 3 }, (_, index) => [...pixels[page]!.slice(index * 3, index * 3 + 3), 255]).flat()));
      }
    }
  });
}
