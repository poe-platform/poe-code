import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Complete alpha planes captured from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { geometry: "80x0+2+1", width: 3, height: 2, alpha: [0, 41, 82, 122, 163, 204] },
    { geometry: "80x0.2+2+1", width: 3, height: 2, alpha: [0, 41, 82, 122, 163, 204] },
    { geometry: "80x1+2+1", width: 7, height: 6, alpha: [0, 0, 1, 3, 3, 2, 0, 1, 3, 9, 17, 17, 9, 2, 2, 11, 30, 48, 46, 23, 5, 3, 16, 42, 63, 58, 28, 6, 2, 10, 25, 36, 33, 16, 3, 0, 2, 6, 9, 8, 4, 1] },
    { geometry: "150x1+2+1", width: 7, height: 6, alpha: [0, 1, 3, 6, 6, 3, 1, 1, 6, 18, 32, 33, 17, 4, 4, 20, 55, 90, 87, 43, 10, 6, 31, 78, 118, 109, 53, 12, 4, 19, 46, 68, 61, 30, 7, 1, 5, 11, 16, 15, 7, 2] },
    { geometry: "80x2+2+1", width: 11, height: 10, alpha: [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 2, 3, 4, 4, 3, 2, 1, 0, 0, 1, 3, 5, 7, 9, 8, 6, 4, 2, 1, 1, 2, 5, 8, 12, 15, 14, 11, 7, 3, 1, 1, 3, 6, 12, 17, 20, 19, 15, 9, 5, 2, 1, 3, 7, 13, 18, 22, 21, 16, 10, 5, 2, 1, 3, 6, 11, 16, 18, 17, 13, 8, 4, 2, 1, 2, 4, 7, 10, 12, 12, 9, 6, 3, 1, 0, 1, 2, 4, 6, 6, 6, 5, 3, 1, 1, 0, 0, 1, 2, 2, 3, 3, 2, 1, 1, 0] },
];

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const page of [undefined, { width: 11, height: 9, x: 4, y: 3 }]) {
        it.each(cases)(`matches partially transparent native shadows for $geometry (${mode}, ${page ? "saved page" : "default page"})`, async ({ geometry, width, height, alpha }) => {
            const input = encodeImage({ width: 3, height: 2, data: Uint8Array.from([0, 51, 102, 153, 204, 255].flatMap(a => [255, 0, 0, a])),
                format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, ...(page ? { virtualCanvas: page } : {}) }, { format: "png" }).data;
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["/input.png", "-background", "#204060", "-shadow", geometry, "PNG32:/out.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(Array.from(output.data)).toEqual(alpha.flatMap(a => [32, 64, 96, a]));
            const pad = (width - 3) / 2;
            expect(output.virtualCanvas).toEqual({ width: (page?.width ?? 3) + pad + 2, height: (page?.height ?? 2) + pad + 1,
                x: (page?.x ?? 0) + 2 - pad, y: (page?.y ?? 0) + 1 - pad });
        });
    }
    it(`preserves native 16-bit samples through the shadow blur (${mode})`, async () => {
        const data16 = Uint16Array.from([0, 0x3311, 0x6677, 0x9988, 0xcc99, 0xffff].flatMap(a => [0x1234, 0x5678, 0x9abc, a]));
        const input = encodeImage({ width: 3, height: 2, data16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-background", "#c02314015291", "-shadow", "80x1+2+1", "PNG64:/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([7, 6]);
        const alpha = [16, 105, 374, 756, 821, 430, 99, 144, 805, 2435, 4380, 4490, 2299, 522, 542, 2806, 7589, 12299, 11857, 5909, 1326, 838, 4187, 10670, 16196, 14938, 7289, 1622, 521, 2564, 6360, 9346, 8416, 4058, 899, 128, 628, 1541, 2233, 1989, 954, 211];
        expect(Array.from(output.data16 ?? [])).toEqual(alpha.flatMap(a => [0xc023, 0x1401, 0x5291, a]));
    });
}
