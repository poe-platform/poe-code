import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const compression of [undefined, "None", "RLE"]) {
    for (const write of [false, true]) {
      for (const gray of [false, true]) {
        it(`preserves PNG representation in TGA (retained=${retained}, compression=${compression}, write=${write}, gray=${gray})`, async () => {
          // Pillow's RGB control and its L conversion from the reported reproduction.
          const pixels = gray ? [76, 150, 29, 225, 57, 75].flatMap(value => [value, value, value])
            : [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 238, 0, 153, 17, 119, 36, 83, 132];
          const data = Uint8Array.from(Array.from({ length: 6 }, (_, i) => [...pixels.slice(i * 3, i * 3 + 3), 255]).flat());
          const input = encodeImage({ width: 3, height: 2, data, format: "raw", space: gray ? "b-w" : "srgb", channels: gray ? 1 : 3, depth: "uchar", hasAlpha: false, density: 72 }, { format: "png" }).data;
          expect(input[25]).toBe(gray ? 0 : 2);
          const files = new Map([["/in.png", input]]);
          const filesystem = new MemoryFileSystem();
          await filesystem.writeFile("/in.png", input);
          const args = ["/in.png", ...(compression ? ["-compress", compression] : []), ...(write ? ["-write", "tga:/out.tga", "/final.png"] : ["/out.tga"])];
          expect(await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
          const output = retained ? await filesystem.readFile("/out.tga") : files.get("/out.tga")!;
          expect(output[2]).toBe((gray ? 3 : 2) + (compression === "RLE" ? 8 : 0));
          expect([...output.subarray(12, 18)]).toEqual([3, 0, 2, 0, gray ? 8 : 24, 0x20]);
          // Check the stored samples independently of the TGA decoder.
          const samples = gray ? pixels.filter((_, i) => i % 3 === 0)
            : Array.from({ length: 6 }, (_, i) => pixels.slice(i * 3, i * 3 + 3).reverse()).flat();
          const rowLength = gray ? 3 : 9;
          expect([...output.subarray(18)]).toEqual(compression === "RLE"
            ? [2, ...samples.slice(0, rowLength), 2, ...samples.slice(rowLength)] : samples);
          const decoded = decodeImage(output);
          expect(decoded).toMatchObject({ channels: gray ? 1 : 3, space: gray ? "b-w" : "srgb", hasAlpha: false });
          expect(decoded.data).toEqual(data);
        });
      }
    }
  }
}
