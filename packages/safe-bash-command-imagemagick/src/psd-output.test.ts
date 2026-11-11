import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("50360a3320320a3235350aff000000ff000000ffffee00991177245384", "hex");

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const destination of ["/out.psd", "PSD:/out.bin"]) {
        it(`writes a Photoshop document from PPM (${mode}, ${destination})`, async () => {
            const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["/in.ppm", "-units", "PixelsPerInch", "-density", "36x72", destination];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const path = destination.startsWith("PSD:") ? destination.slice(4) : destination;
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            expect(Buffer.from(bytes.subarray(0, 16)).toString("hex")).toBe("38425053000100000000000000030000");
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            expect([view.getUint32(14), view.getUint32(18), view.getUint16(22), view.getUint16(24)]).toEqual([2, 3, 8, 3]);
            let offset = 30 + view.getUint32(26);
            const resourcesEnd = offset + 4 + view.getUint32(offset);
            offset += 4;
            expect(Buffer.from(bytes.subarray(offset, offset + 4)).toString()).toBe("8BIM");
            expect(view.getUint16(offset + 4)).toBe(1005);
            expect([view.getUint32(offset + 12) / 65536, view.getUint32(offset + 20) / 65536]).toEqual([36, 72]);
            offset = resourcesEnd;
            expect(view.getInt16(offset + 8)).toBe(1); // One editable layer as well as the composite.
            offset += 4 + view.getUint32(offset);
            expect(view.getUint16(offset)).toBe(0); // Uncompressed composite planes.
            const pixels = bytes.subarray(offset + 2), rgb = input.subarray(11);
            for (let channel = 0; channel < 3; channel++) {
                expect(Array.from(pixels.subarray(channel * 6, (channel + 1) * 6))).toEqual(Array.from({ length: 6 }, (_, pixel) => rgb[pixel * 3 + channel]));
            }
        });
    }
    it(`keeps TIFF output working (${mode})`, async () => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-units", "PixelsPerInch", "-density", "36x72", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("/out.tif")!;
        expect(decodeImage(bytes).format).toBe("tiff");
        expect(decodeImage(bytes).data).toEqual(decodeImage(input).data);
    });
}
