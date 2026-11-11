import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2-35 writes samples in input order and sets the TGA origin.
// BottomRight's decoded RGB control is the exact raster from the native repro.
const origins = [
  { name: undefined, descriptor: 0x20, order: [0, 1, 2, 3, 4, 5] },
  { name: "Undefined", descriptor: 0x20, order: [0, 1, 2, 3, 4, 5] },
  { name: "TopLeft", descriptor: 0x20, order: [0, 1, 2, 3, 4, 5] },
  { name: "TopRight", descriptor: 0x30, order: [2, 1, 0, 5, 4, 3] },
  { name: "BottomRight", descriptor: 0x10, order: [5, 4, 3, 2, 1, 0] },
  { name: "BottomLeft", descriptor: 0, order: [3, 4, 5, 0, 1, 2] },
  // TGA has no rotated origins; native uses bottom-left for these orientations.
  ...["LeftTop", "RightTop", "RightBottom", "LeftBottom"].map(name =>
    ({ name, descriptor: 0, order: [3, 4, 5, 0, 1, 2] }))
];

for (const mode of ["buffered", "retained"]) {
  for (const compression of ["None", "RLE"]) {
    for (const write of [false, true]) {
      for (const kind of ["RGB", "L", "P", "RGBA"]) {
        it.each(origins)(`writes origin $name and its raster (${mode}, ${compression}, write=${write}, ${kind})`, async ({ name, descriptor, order }) => {
          const colors = kind === "L" ? [76, 150, 29, 225, 57, 75].map(value => [value, value, value])
            : [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 238, 0], [153, 17, 119], [36, 83, 132]];
          const pixels = colors.map((color, i) => [...color, kind === "RGBA" ? [255, 127, 0, 64, 192, 255][i]! : 255]);
          const input = encodeImage({ width: 3, height: 2, data: Uint8Array.from(pixels.flat()), format: "raw",
            space: kind === "L" ? "b-w" : "srgb", channels: kind === "L" ? 1 : kind === "RGBA" ? 4 : 3,
            depth: "uchar", hasAlpha: kind === "RGBA", density: 72 },
          { format: "png", ...(kind === "P" ? { palette: true, pngColorType: 3 as const } : {}) }).data;
          expect(input[25]).toBe(kind === "P" ? 3 : kind === "L" ? 0 : kind === "RGBA" ? 6 : 2);
          const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
          await filesystem.writeFile("/in.png", input);
          const args = ["/in.png", ...(name ? ["-orient", name] : []), "-compress", compression,
            ...(write ? ["-write", "tga:/out.tga", "/final.png"] : ["/out.tga"])];
          expect(await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
          const output = mode === "retained" ? await filesystem.readFile("/out.tga") : files.get("/out.tga")!;
          expect(output[17]).toBe(descriptor | (kind === "RGBA" ? 8 : 0));
          expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, data: Uint8Array.from(order.flatMap(i => pixels[i]!)) });
          if (name === "BottomRight" && kind === "RGB") {
            expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe("245384ff991177ffffee00ff0000ffff00ff00ffff0000ff");
          }
          if (write) {
            const final = mode === "retained" ? await filesystem.readFile("/final.png") : files.get("/final.png")!;
            expect(decodeImage(final).data).toEqual(Uint8Array.from(pixels.flat()));
          }
        });
      }
    }
  }
}
