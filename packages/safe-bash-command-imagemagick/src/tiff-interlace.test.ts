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
    it.each(["plane", "none", "default", "reset"])(`writes actual TIFF channel planes and contiguous controls (${mode}, %s)`, async interlace => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const options = interlace === "default" ? [] : interlace === "reset" ? ["-interlace", "plane", "+interlace"] : ["-interlace", interlace];
        const result = mode === "sync" ? runConvertCliSync(["/in.png", ...options, "-write", "/copy.tif", "/out.tif"], files) : await runConvertCli(["/in.png", ...options, "-write", "/copy.tif", "/out.tif"], mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73;
            const ifd = view.getUint32(4, little), tags = new Map<number, number[]>();
            for (let i = 0; i < view.getUint16(ifd, little); i++) {
                const at = ifd + 2 + i * 12, size = view.getUint16(at + 2, little) === 3 ? 2 : 4, count = view.getUint32(at + 4, little);
                const offset = size * count <= 4 ? at + 8 : view.getUint32(at + 8, little);
                tags.set(view.getUint16(at, little), Array.from({ length: count }, (_, n) => size === 2 ? view.getUint16(offset + n * size, little) : view.getUint32(offset + n * size, little)));
            }
            const planar = interlace === "plane";
            expect(tags.get(284)).toEqual([planar ? 2 : 1]);
            const offsets = tags.get(273)!, sizes = tags.get(279)!;
            expect(offsets).toHaveLength(planar ? 4 : 1);
            for (let channel = 0; channel < offsets.length; channel++) {
                expect(bytes.subarray(offsets[channel]!, offsets[channel]! + sizes[channel]!)).toEqual(planar ? pixels.filter((_, i) => i % 4 === channel) : pixels);
            }
        }
    });
}

for (const mode of ["sync", "retained"] as const) {
    it.each(["None", "LZW", "Zip", "RLE"])(`preserves planar pixels with partial strips and tiles (${mode}, %s)`, async compression => {
        for (const layout of [["-define", "tiff:rows-per-strip=13"], ["-define", "tiff:tile-geometry=32x16"]]) {
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", "-interlace", "Plane", "-compress", compression, "-define", "tiff:endian=msb", ...layout, "/out.tif"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const bytes = mode === "sync" ? files.get("/out.tif")! : await filesystem.readFile("/out.tif");
            expect(sharp(bytes).raw().toBufferSync()).toEqual(pixels);
        }
    });
}

it("rejects unsupported interlace settings without replacing output", () => {
    for (const options of [["-interlace", "invalid"], ["-interlace", "plane", "-compress", "JPEG"]]) {
        const files = new Map([["/in.png", input], ["/out.tif", input]]);
        expect(runConvertCliSync(["/in.png", ...options, "/out.tif"], files).exitCode).toBe(1);
        expect(files.get("/out.tif")).toEqual(input);
    }
});
