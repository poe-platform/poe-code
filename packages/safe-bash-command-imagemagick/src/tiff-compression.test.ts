import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) => i % 4 === 3 ? 255 : (7 * (Math.floor(i / 4) % 48) + 11 * Math.floor(i / 192)) % 256);
const input = sharp(pixels, { raw: { width: 48, height: 40, channels: 4 } }).greyscale().png().toBufferSync();
function compression(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ifd = view.getUint32(4, true);
    for (let n = 0; n < view.getUint16(ifd, true); n++) {
        const at = ifd + 2 + n * 12;
        if (view.getUint16(at, true) === 259) return view.getUint16(at + 8, true);
    }
}
for (const rows of [undefined, 7]) for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([["None", 1], ["LZW", 5], ["Zip", 8], ["RLE", 32773], ["JPEG", 7]] as const)(`encodes %s TIFF in ${mode} conversion (strip rows: ${rows ?? "default"})`, async (method, tag) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(rows === undefined ? [] : ["-define", `tiff:rows-per-strip=${rows}`]), "-compress", method, "-write", "/copy.tif", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            expect(compression(bytes)).toBe(tag);
            const decoded = decodeImage(bytes);
            expect([decoded.width, decoded.height]).toEqual([48, 40]);
            if (method !== "JPEG") expect(decoded.data).toEqual(pixels);
        }
    });
}
it("resets compression and keeps the uncompressed default", () => {
    const files = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "-compress", "LZW", "+compress", "/out.tif"], files).exitCode).toBe(0);
    expect(compression(files.get("/out.tif")!)).toBe(1);
    expect(compression(encodeImage(decodeImage(input), { format: "tiff" }).data)).toBe(1);
});
