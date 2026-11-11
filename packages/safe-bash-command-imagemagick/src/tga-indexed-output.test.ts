import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Six-color PNG and native ImageMagick 7.1.2-35 Q16-HDRI TGA references.
const input = Buffer.from("89504e470d0a1a0a0000000d4948445200000003000000020803000000aaaa962800000012504c5445ff000000ff000000ffffee00991177245384a58b0d500000001049444154789c63606064626066610500002e001012d968830000000049454e44ae426082", "hex");
const alphaInput = Buffer.from("89504e470d0a1a0a0000000d4948445200000003000000020803000000aaaa962800000012504c5445ff000000ff000000ffffee00991177245384a58b0d500000000674524e53ff8000ffffff3b3a3add0000001049444154789c63606064626066610500002e001012d968830000000049454e44ae426082", "hex");

for (const mode of ["sync", "map", "filesystem"]) for (const rle of [false, true]) for (const alpha of [false, true]) for (const write of [false, true]) {
  it(`preserves indexed TGA representation (${mode}, rle=${rle}, alpha=${alpha}, write=${write})`, async () => {
    const png = alpha ? alphaInput : input;
    const files = new Map([["/in.png", png]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", png);
    const args = ["/in.png", ...(rle ? ["-compress", "RLE"] : []), ...(write ? ["-write", "TGA:/out.tga", "/final.png"] : ["/out.tga"])];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "filesystem" ? await filesystem.readFile("/out.tga") : files.get("/out.tga")!;
    expect([...bytes.subarray(0, 18)]).toEqual([0, 1, rle ? 9 : 1, 0, 0, 6, 0, alpha ? 32 : 24, 0, 0, 0, 0, 3, 0, 2, 0, 8, 32]);
    const palette = alpha ? "0000ffff00ff0080ff00000000eeffff771199ff845324ff" : "0000ff00ff00ff000000eeff771199845324";
    expect(Buffer.from(bytes.subarray(18)).toString("hex")).toBe(palette + (rle ? "0200010202030405" : "000102030405"));
    // Inspect raster independently of our TGA decoder: each raw packet has three indices.
    const indices = rle ? [0, 1, 2, 3, 4, 5].map(i => bytes[18 + palette.length / 2 + i + 1 + Math.floor(i / 3)]!) : [...bytes.subarray(18 + palette.length / 2)];
    const pixels = indices.flatMap(index => {
      const offset = 18 + index * (alpha ? 4 : 3);
      return [bytes[offset + 2], bytes[offset + 1], bytes[offset], alpha ? bytes[offset + 3] : 255];
    });
    expect(pixels).toEqual([...decodeImage(png).data]);
    if (write) expect(decodeImage(mode === "filesystem" ? await filesystem.readFile("/final.png") : files.get("/final.png")!).data).toEqual(decodeImage(png).data);
  });
}
