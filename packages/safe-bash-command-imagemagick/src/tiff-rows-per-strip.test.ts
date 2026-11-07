import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) => i % 4 === 3 ? 255 : (7 * (Math.floor(i / 4) % 48) + 11 * Math.floor(i / 192)) % 256);
const input = sharp(pixels, { raw: { width: 48, height: 40, channels: 4 } }).greyscale().removeAlpha().png().toBufferSync();
function tags(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ifd = view.getUint32(4, true);
    const result = new Map<number, number[]>();
    for (let n = 0; n < view.getUint16(ifd, true); n++) {
        const at = ifd + 2 + n * 12, tag = view.getUint16(at, true);
        if (![273, 278, 279].includes(tag)) continue;
        const count = view.getUint32(at + 4, true), offset = count === 1 ? at + 8 : view.getUint32(at + 8, true);
        result.set(tag, Array.from({ length: count }, (_, i) => view.getUint32(offset + i * 4, true)));
    }
    return result;
}
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([5, 10, 7, 40, 1, 80])(`writes requested TIFF strips in ${mode} conversion (%i rows)`, async rows => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-define", `tiff:rows-per-strip=${rows}`, "-write", "/copy.tif", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const fields = tags(bytes), count = Math.ceil(40 / rows);
            expect(fields.get(278)).toEqual([rows]);
            expect(fields.get(273)).toHaveLength(count);
            expect(fields.get(279)).toEqual(Array.from({ length: count }, (_, i) => 48 * Math.min(rows, 40 - i * rows)));
            for (let i = 0; i < count; i++) {
                const offset = fields.get(273)![i]!, size = fields.get(279)![i]!;
                expect(bytes.subarray(offset, offset + size)).toEqual(Uint8Array.from({ length: size }, (_, j) => pixels[(i * rows * 48 + j) * 4]!));
            }
            expect(decodeImage(bytes).data).toEqual(pixels);
        }
    });
}
it("resets the rows-per-strip define", () => {
    const files = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "-define", "tiff:rows-per-strip=5", "+define", "tiff:rows-per-strip", "/out.tif"], files).exitCode).toBe(0);
    expect(tags(files.get("/out.tif")!).get(278)).toEqual([40]);
});

for (const method of ["LZW", "Zip", "RLE"] as const) {
    it.each(["sync", "retained"])(`preserves pixels across independently compressed ${method} strips (%s)`, async mode => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-define", "tiff:rows-per-strip=7", "-compress", method, "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const bytes = mode === "sync" ? files.get("/out.tif")! : await filesystem.readFile("/out.tif");
        expect(tags(bytes).get(273)).toHaveLength(6);
        expect(decodeImage(bytes).data).toEqual(pixels);
    });
}
it.each(["sync", "retained"])("preserves strip offsets and pixels on later TIFF pages (%s)", async mode => {
    const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "/in.png", "-define", "tiff:rows-per-strip=7", "/out.tif"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const bytes = mode === "sync" ? files.get("/out.tif")! : await filesystem.readFile("/out.tif");
    const first = decodeImage(bytes), second = decodeImage(bytes, { page: 1 });
    expect(first.data).toEqual(pixels);
    expect(second.data).toEqual(pixels);
});
