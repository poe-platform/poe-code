import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) => {
    const x = Math.floor(i / 4) % 48, y = Math.floor(i / 192);
    return [(7 * x + 11 * y) % 256, 60, 200, x % 2 ? 128 : 255][i % 4]!;
});
const input = sharp(pixels, { raw: { width: 48, height: 40, channels: 4 } }).png().toBufferSync();

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["associated", "unassociated", "unspecified"])(`writes TIFF alpha tag and native sample bytes (${mode}, %s)`, async alpha => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-define", `tiff:alpha=${alpha}`, "-write", "/copy.tif", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
            const ifd = view.getUint32(4, little), tags = new Map<number, number>();
            for (let i = 0; i < view.getUint16(ifd, little); i++) {
                const at = ifd + 2 + i * 12;
                tags.set(view.getUint16(at, little), view.getUint16(at + 2, little) === 3 ? view.getUint16(at + 8, little) : view.getUint32(at + 8, little));
            }
            expect(tags.get(338)).toBe(alpha === "associated" ? 1 : alpha === "unspecified" ? 0 : 2);
            const offset = tags.get(273)!;
            expect(Array.from(bytes.subarray(offset, offset + 8))).toEqual(alpha === "associated" ? [0, 60, 200, 255, 4, 30, 100, 64] : [0, 60, 200, 255, 7, 60, 200, 128]);
        }
    });
}

it("resets the alpha definition to unassociated", () => {
    const files = new Map([["/in.png", input]]);
    const args = ["/in.png", "-define", "tiff:alpha=associated", "+define", "tiff:alpha", "/out.tif"];
    expect(runConvertCliSync(args, files).exitCode).toBe(0);
    const reference = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "/out.tif"], reference).exitCode).toBe(0);
    expect(files.get("/out.tif")).toEqual(reference.get("/out.tif"));
});

for (const gray of [false, true]) {
    it.each(["none", "lzw", "zip", "rle"])(`matches retained and buffered associated samples across tiled pages (gray=${gray}, %s)`, async compression => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "/in.png", ...(gray ? ["-colorspace", "gray"] : []), "-define", "tiff:alpha=associated", "-define", "tiff:tile-geometry=32x16", "-compress", compression, "/out.tif"];
        expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0, stderr: "" });
        expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
        expect(await filesystem.readFile("/out.tif")).toEqual(files.get("/out.tif"));
    });
}
