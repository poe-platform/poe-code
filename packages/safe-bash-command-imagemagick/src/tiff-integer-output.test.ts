import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from([0, 10, 40, 255, 128, 200, 255, 255]);
const input = sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).removeAlpha().png().toBufferSync();
for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const depth of [8, 16, 32]) {
      for (const signed of [false, true]) {
        it.each(["lsb", "msb"])(`writes integer TIFF tags and samples (${mode}, ${depth}, signed=${signed}, %s)`, async endian => {
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", "-define", `quantum:format=${signed ? "signed" : "unsigned"}`, "-depth", String(depth), "-define", `tiff:endian=${endian}`, "-write", "/copy.tif", "/out.tif"];
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
                expect(tags.get(339)).toBe(signed ? 2 : 1);
                expect(tags.get(258)).toBe(depth);
                expect(tags.get(279)).toBe(6 * depth / 8);
                const offset = tags.get(273)!;
                const sample = (index: number) => depth === 8 ? view.getUint8(offset + index) : depth === 16 ? view.getUint16(offset + index * 2, little) : view.getUint32(offset + index * 4, little);
                for (let i = 0; i < 6; i++) expect(sample(i)).toBe(pixels[Math.floor(i / 3) * 4 + i % 3]! * ((2 ** depth - 1) / 255));
            }
        });
    }
}

}

for (const planar of [false, true]) {
    it.each(["none", "lzw", "zip", "rle"])(`writes integer tiled pages (planar=${planar}, %s)`, async compression => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "/in.png", "-depth", "16", "-define", "tiff:tile-geometry=16x16", "-interlace", planar ? "plane" : "none", "-compress", compression, "/out.tif"];
        expect(runConvertCliSync(args, files)).toMatchObject({ exitCode: 0, stderr: "" });
        expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = await filesystem.readFile("/out.tif");
        expect(bytes).toEqual(files.get("/out.tif"));
        for (const page of [0, 1]) expect(decodeImage(bytes, { page }).data).toEqual(pixels);
    });
}

it.each(["sync", "buffered", "retained"] as const)("resets signed depth after a staged write (%s)", async mode => {
    const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-define", "quantum:format=signed", "-depth", "16", "-write", "/signed.tif", "+define", "quantum:format", "+depth", "/out.tif"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0, stderr: "" });
    const reference = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "+depth", "/out.tif"], reference).exitCode).toBe(0);
    const bytes = mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!;
    expect(bytes).toEqual(reference.get("/out.tif"));
    const signed = mode === "retained" ? await filesystem.readFile("/signed.tif") : files.get("/signed.tif")!;
    expect(signed).not.toEqual(bytes);
});
