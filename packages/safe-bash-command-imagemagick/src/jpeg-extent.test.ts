import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const data = new Uint8Array(128 * 96 * 4);
for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
    data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * 128 + x) * 4);
}
const png = encodeImage({ width: 128, height: 96, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
for (const retained of [false, true]) {
    it(`limits JPEG bytes without resizing and captures each write, retained=${retained}`, async () => {
        const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
        await fs.writeFile("/grid.png", png);
        const result = await runConvertCli(["grid.png", "-define", "jpeg:extent=4KB", "-write", "small.jpg", "-define", "jpeg:extent=8KB", "-write", "medium.jpg", "+define", "jpeg:extent", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const sizes: number[] = [];
        for (const path of ["small.jpg", "medium.jpg", "out.jpg"]) {
            const bytes = retained ? await fs.readFile(`/${path}`) : files.get(path)!;
            sizes.push(bytes.length);
            const image = decodeImage(bytes);
            expect([image.width, image.height]).toEqual([128, 96]);
        }
        expect(sizes[0]).toBeLessThanOrEqual(4000);
        expect(sizes[1]).toBeLessThanOrEqual(8000);
        expect(sizes[1]).toBeGreaterThan(sizes[0]!);
        expect(sizes[2]).toBeGreaterThan(8000);
    });
}

for (const retained of [false, true]) {
    it.each(["4000", "4KiB", "0.004MB"])(`limits final numbered JPEG output (%s), retained=${retained}`, async extent => {
        const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
        await fs.writeFile("/grid.png", png);
        const result = await runConvertCli(["grid.png", "-duplicate", "1", "-define", `jpeg:extent=${extent}`, "out-%d.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        for (const path of ["out-0.jpg", "out-1.jpg"]) {
            const bytes = retained ? await fs.readFile(`/${path}`) : files.get(path)!;
            expect(bytes.length).toBeLessThanOrEqual(extent === "4KiB" ? 4096 : 4000);
            expect(decodeImage(bytes)).toMatchObject({ width: 128, height: 96 });
        }
    });
    it(`handles infeasible limits and preserves non-JPEG output, retained=${retained}`, async () => {
        const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
        await fs.writeFile("/grid.png", png);
        const result = await runConvertCli(["grid.png", "-quality", "1", "-write", "minimum.jpg", "-quality", "92", "-define", "jpeg:extent=1", "-write", "limited.jpg", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const read = async (path: string) => retained ? fs.readFile(`/${path}`) : files.get(path)!;
        expect(await read("limited.jpg")).toEqual(await read("minimum.jpg"));
        expect(decodeImage(await read("out.png")).data).toEqual(data);
    });
    it(`keeps quality as the upper bound, retained=${retained}`, async () => {
        const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
        await fs.writeFile("/grid.png", png);
        const result = await runConvertCli(["grid.png", "-quality", "20", "-write", "original.jpg", "-define", "jpeg:extent=1MB", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(retained ? await fs.readFile("/out.jpg") : files.get("out.jpg")).toEqual(retained ? await fs.readFile("/original.jpg") : files.get("original.jpg"));
    });
}
