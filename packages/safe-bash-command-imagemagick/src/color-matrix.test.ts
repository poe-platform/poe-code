import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([0, 2, 3, 5, 8, 10, 15, 17, 24, 26, 35, 37])(`-color-matrix rejects %i coefficients, retained=${retained}`, async (count) => {
        const bytes = await sharp(new Uint8Array([200, 100, 50, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes], ["/out.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        await fs.writeFile("/out.png", bytes);
        const matrix = Array.from({ length: count }, (_, i) => i === 0 ? 1 : 0).join(" ");
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid color matrix");
        expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(bytes);
    });

    it.each(["2x2: 0 1 0 1 0 0 0 0 1", "2x1: 0", "1x2: 0 1 0"])(`-color-matrix rejects mismatched dimensions: %s, retained=${retained}`, async (matrix) => {
        const bytes = await sharp(new Uint8Array([255, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes], ["/out.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        await fs.writeFile("/out.png", bytes);
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid color matrix");
        expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(bytes);
    });

    it.each([
        { matrix: "Sobel", expected: [150, 255, 150, 128] },
        { matrix: "Unity", expected: [200, 100, 50, 128] },
        { matrix: "Unity:", expected: [200, 100, 50, 128] },
        { matrix: "Unity:0", expected: [0, 100, 50, 128] },
        { matrix: "Unity:1", expected: [200, 100, 50, 128] },
        { matrix: "Unity:2", expected: [255, 100, 50, 128] },
        { matrix: "Square:1", expected: [255, 255, 255, 128] },
        { matrix: "Square:0.2", expected: [255, 255, 255, 128] },
        { matrix: "Square:3", expected: [255, 255, 255, 255] },
        { matrix: "Unity:0.5", expected: [100, 100, 50, 128] },
        { matrix: "2x1: 0 1", expected: [100, 100, 50, 128] },
        { matrix: "1x2: 0 1", expected: [0, 255, 50, 128] },
        { matrix: "3x3: 0 1 0 1 0 0 0 0 1", expected: [100, 200, 50, 128] },
        { matrix: "0.5", expected: [100, 100, 50, 128] },
        { matrix: "0 1 1 0", expected: [100, 200, 50, 128] },
        { matrix: "1 0 0 1", expected: [200, 100, 50, 128] },
        { matrix: "2 0 0 -1", expected: [255, 0, 50, 128] },
        { matrix: "0 1 0 0 0 1 1 0 0", expected: [100, 50, 200, 128] },
    ])(`-color-matrix $matrix preserves unaffected channels, retained=${retained}`, async ({ matrix, expected }) => {
        const bytes = await sharp(new Uint8Array([200, 100, 50, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

for (const retained of [false, true]) {
    it.each([
        { matrix: "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.5", expected: [25, 100, 220, 64] },
        { matrix: "1 0 0 0 0.5 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1", expected: [89, 100, 220, 128] },
        { matrix: "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0.5", expected: [25, 100, 220, 128] },
        { matrix: "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 1 0 0 0 0", expected: [25, 100, 220, 25] },
    ])(`-color-matrix uses the fifth row and column for alpha: $matrix, retained=${retained}`, async ({ matrix, expected }) => {
        const bytes = await sharp(new Uint8Array([25, 100, 220, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
