import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const compression of [undefined, "None", "RLE"]) {
    for (const write of [false, true]) {
      it(`writes TGA pixels (retained=${retained}, compression=${compression}, write=${write})`, async () => {
        const colors = [[230, 10, 40, 255], [20, 190, 60, 127], [40, 70, 210, 0]];
        const data = Uint8Array.from(Array.from({ length: 36 }, (_, i) => colors[(Math.floor(i / 12) + Number(i % 12 > 8)) % 3]!).flat());
        const input = encodeImage({ width: 12, height: 3, data, format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: true, density: 72 }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(compression ? ["-compress", compression] : []), ...(write ? ["-write", "tga:/out.tga", "/final.png"] : ["/out.tga"])];
        const result = await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = retained ? await filesystem.readFile("/out.tga") : files.get("/out.tga")!;
        expect([...output.subarray(0, 3)]).toEqual([0, 0, compression === "RLE" ? 10 : 2]);
        expect([...output.subarray(12, 18)]).toEqual([12, 0, 3, 0, 32, 0x28]);
        expect(output.length).toBe(compression === "RLE" ? 48 : 162);
        expect(decodeImage(output).data).toEqual(data);
      });
    }
  }
}
