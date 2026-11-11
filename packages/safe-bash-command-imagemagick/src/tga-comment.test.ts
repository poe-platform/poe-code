import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
  for (const pngColorType of [0, 2, 3] as const) {
    for (const compression of ["None", "RLE"]) {
      it(`writes TGA comment bytes from PNG type ${pngColorType} (${mode}, ${compression})`, async () => {
        const pixels = pngColorType === 0 ? [76, 150, 29, 225, 57, 75].flatMap(value => [value, value, value])
          : [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 238, 0, 153, 17, 119, 36, 83, 132];
        const data = Uint8Array.from(Array.from({ length: 6 }, (_, i) => [...pixels.slice(i * 3, i * 3 + 3), 255]).flat());
        const input = encodeImage({ width: 3, height: 2, data, format: "raw", space: pngColorType === 0 ? "b-w" : "srgb",
          channels: pngColorType === 0 ? 1 : 3, depth: "uchar", hasAlpha: false, density: 72 }, { format: "png", pngColorType }).data;
        expect(input[25]).toBe(pngColorType);
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-compress", compression, "-write", "/plain.tga", "-set", "comment", "ticket",
          "-write", "/comment.tga", "+set", "comment", "/cleared.tga"];
        expect(mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
        const [plain, output, cleared] = await Promise.all(["/plain.tga", "/comment.tga", "/cleared.tga"].map(
          async path => mode === "retained" ? filesystem.readFile(path) : files.get(path)!
        ));
        expect(plain![0]).toBe(0);
        expect(output![0]).toBe(6);
        expect([...output!.subarray(18, 24)]).toEqual([116, 105, 99, 107, 101, 116]);
        expect(output!.subarray(1, 18)).toEqual(plain!.subarray(1, 18));
        expect(output!.subarray(24)).toEqual(plain!.subarray(18));
        expect(cleared).toEqual(plain);
        expect(decodeImage(output!).data).toEqual(data);
      });
    }
  }
}
