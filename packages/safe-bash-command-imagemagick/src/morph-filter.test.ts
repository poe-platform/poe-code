import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, RGB inputs with unequal dimensions.
const filteredMorphs = {
    "point": [0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 128, 128, 255, 255, 128, 128, 255, 255, 0, 0, 128, 255, 0, 0, 128, 255, 128, 128, 255, 255, 128, 128, 255, 255],
    "triangle": [0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128, 255, 16, 16, 143, 255, 48, 48, 175, 255, 64, 64, 191, 255, 0, 0, 128, 255, 32, 32, 159, 255, 96, 96, 223, 255, 128, 128, 255, 255],
    "mitchell": [0, 0, 128, 255, 0, 0, 127, 255, 0, 0, 127, 255, 0, 0, 126, 255, 0, 0, 126, 255, 16, 16, 143, 255, 48, 48, 176, 255, 66, 66, 193, 255, 0, 0, 124, 255, 32, 32, 159, 255, 97, 97, 224, 255, 132, 132, 255, 255],
    "catrom": [1, 1, 128, 255, 0, 0, 126, 255, 0, 0, 121, 255, 0, 0, 118, 255, 0, 0, 122, 255, 13, 13, 141, 255, 51, 51, 178, 255, 69, 69, 197, 255, 0, 0, 116, 255, 28, 28, 156, 255, 108, 108, 235, 255, 148, 148, 255, 255],
    "lanczos2": [1, 1, 129, 255, 0, 0, 125, 255, 0, 0, 119, 255, 0, 0, 116, 255, 0, 0, 121, 255, 13, 13, 141, 255, 50, 50, 178, 255, 71, 71, 198, 255, 0, 0, 113, 255, 29, 29, 157, 255, 109, 109, 236, 255, 153, 153, 255, 255],
    "lanczos": [3, 3, 130, 255, 0, 0, 124, 255, 0, 0, 115, 255, 0, 0, 109, 255, 0, 0, 116, 255, 15, 15, 142, 255, 49, 49, 176, 255, 75, 75, 202, 255, 0, 0, 102, 255, 33, 33, 161, 255, 110, 110, 237, 255, 168, 168, 255, 255],
    "default": [0, 0, 128, 255, 0, 0, 127, 255, 0, 0, 127, 255, 0, 0, 126, 255, 0, 0, 126, 255, 16, 16, 143, 255, 48, 48, 176, 255, 66, 66, 193, 255, 0, 0, 124, 255, 32, 32, 159, 255, 97, 97, 224, 255, 132, 132, 255, 255],
};
for (const [filter, pixels] of Object.entries(filteredMorphs))
for (const mode of ["map", "sync", "filesystem"])
it(`honors the morph resize filter: ${filter}, ${mode}`, async () => {
    const small = await sharp(Uint8Array.of(0,0,0, 0,0,0, 0,0,0, 255,255,255), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
    const big = await sharp(Uint8Array.from(Array.from({ length: 24 }, () => [0,0,255]).flat()), { raw: { width: 6, height: 4, channels: 3 } }).png().toBuffer();
    const files = new Map([["/small.png", small], ["/big.png", big]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/small.png", "-repage", "20x20+4+8", "/big.png", "-repage", "30x30+8+6", ...(filter === "default" ? [] : ["-filter", filter]), "-morph", "1", "-delete", "0,2", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([4, 3]);
    expect([...output.data]).toEqual(pixels);
});
