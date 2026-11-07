import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) => i % 4 === 3 ? 255 : (7 * (Math.floor(i / 4) % 48) + 11 * Math.floor(i / 192)) % 256);
const input = sharp(pixels, { raw: { width: 48, height: 40, channels: 4 } }).greyscale().removeAlpha().png().toBufferSync();
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["msb", "lsb"])(`writes valid TIFF byte order and exact pixels (${mode}, %s)`, async endian => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-define", `tiff:endian=${endian}`, "-define", "tiff:rows-per-strip=7", "-write", "/copy.tif", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            expect(Array.from(bytes.subarray(0, 2))).toEqual(endian === "msb" ? [77, 77] : [73, 73]);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = endian === "lsb";
            expect(view.getUint16(2, little)).toBe(42);
            const ifd = view.getUint32(4, little);
            expect(view.getUint16(ifd, little)).toBeGreaterThan(10);
            expect(decodeImage(bytes).data).toEqual(pixels);
        }
    });
}
it("resets the TIFF endian definition", () => {
    const files = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "-define", "tiff:endian=msb", "+define", "tiff:endian", "/out.tif"], files).exitCode).toBe(0);
    expect(Array.from(files.get("/out.tif")!.subarray(0, 2))).toEqual([73, 73]);
});

it.each([1, 2, 3, 4])("preserves %i-channel samples and linked directories in big-endian TIFF", async channels => {
    let image = sharp(pixels, { raw: { width: 48, height: 40, channels: 4 } });
    if (channels < 3) image = image.greyscale();
    if (channels % 2 === 1) image = image.removeAlpha();
    const png = image.png().toBufferSync(), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", png);
    const result = await runConvertCli(["/in.png", "/in.png", "-define", "tiff:endian=msb", "-define", "tiff:tile-geometry=32x16", "/out.tif"], { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = await filesystem.readFile("/out.tif");
    expect(Array.from(bytes.subarray(0, 2))).toEqual([77, 77]);
    for (const page of [0, 1]) expect(decodeImage(bytes, { page }).data).toEqual(pixels);
});
