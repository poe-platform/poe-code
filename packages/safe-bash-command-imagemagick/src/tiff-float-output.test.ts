import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from([0, 10, 40, 255, 17, 41, 87, 255]);
const input = sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).removeAlpha().png().toBufferSync();
for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const depth of [16, 32]) {
        it.each(["lsb", "msb"])(`writes IEEE float TIFF tags and samples (${mode}, ${depth}, %s)`, async endian => {
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", "-define", "quantum:format=floating-point", "-depth", String(depth), "-define", `tiff:endian=${endian}`, "-write", "/copy.tif", "/out.tif"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            for (const path of ["/copy.tif", "/out.tif"]) {
                const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = endian === "lsb";
                const ifd = view.getUint32(4, little), tags = new Map<number, number>();
                for (let i = 0; i < view.getUint16(ifd, little); i++) {
                    const at = ifd + 2 + i * 12, type = view.getUint16(at + 2, little), count = view.getUint32(at + 4, little);
                    tags.set(view.getUint16(at, little), type === 3 ? view.getUint16(count > 2 ? view.getUint32(at + 8, little) : at + 8, little) : view.getUint32(at + 8, little));
                }
                expect(tags.get(339)).toBe(3);
                expect(tags.get(258)).toBe(depth);
                expect(tags.get(279)).toBe(6 * depth / 8);
                const offset = tags.get(273)!;
                if (depth === 32) {
                    expect(view.getFloat32(offset, little)).toBe(0);
                    expect(view.getFloat32(offset + 4, little)).toBeCloseTo(10 / 255, 7);
                    expect(view.getFloat32(offset + 8, little)).toBeCloseTo(40 / 255, 7);
                } else {
                    expect(view.getUint16(offset, little)).toBe(0);
                    expect(view.getUint16(offset + 2, little)).toBe(0x2905);
                    expect(view.getUint16(offset + 4, little)).toBe(0x3105);
                }
                expect(decodeImage(bytes).data).toEqual(pixels);
            }
        });
    }
}

for (const depth of [16, 32]) {
    for (const planar of [false, true]) {
        it.each(["none", "lzw", "zip", "rle"])(`preserves samples across compressed tiled pages (${depth}, planar=${planar}, %s)`, async compression => {
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", "/in.png", "-define", "quantum:format=floating-point", "-depth", String(depth), "-define", "tiff:tile-geometry=16x16", "-interlace", planar ? "plane" : "none", "-compress", compression, "/out.tif"];
            expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0, stderr: "" });
            expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
            const bytes = await filesystem.readFile("/out.tif");
            expect(bytes).toEqual(files.get("/out.tif"));
            for (const page of [0, 1]) expect(decodeImage(bytes, { page }).data).toEqual(pixels);
        });
    }
}

it.each(["sync", "buffered", "retained"] as const)("resets float output after a staged write (%s)", async mode => {
    const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-define", "quantum:format=floating-point", "-depth", "32", "-write", "/float.tif", "+define", "quantum:format", "-depth", "8", "/out.tif"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0, stderr: "" });
    const reference = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "-depth", "8", "/out.tif"], reference).exitCode).toBe(0);
    const bytes = mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!;
    expect(bytes).toEqual(reference.get("/out.tif"));
    const floating = mode === "retained" ? await filesystem.readFile("/float.tif") : files.get("/float.tif")!;
    expect(floating).not.toEqual(bytes);
});
