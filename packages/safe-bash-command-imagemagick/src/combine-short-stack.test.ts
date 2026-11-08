import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const [colors, rgba] of [
        [["white"], [255, 255, 255, 255]],
        [["white", "white"], [255, 255, 255, 255]],
        [["red"], [54, 0, 0, 255]],
        [["blue", "lime"], [18, 182, 255, 255]],
        [["red", "lime"], [54, 182, 0, 255]],
        [["red", "lime", "blue"], [54, 182, 18, 255]]
    ] as const) {
        it(`${mode}: combines ${colors.join(", ")} into one pixel`, async () => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            for (const color of colors) {
                const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: color } }).png().toBuffer();
                files.set(`/${color}.png`, bytes);
                await filesystem.writeFile(`/${color}.png`, bytes);
            }
            const args = [...colors.map(color => `/${color}.png`), "-combine", "+append", "/out.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([1, 1]);
            expect([...output.data]).toEqual(rgba);
        });
    }
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode}: retains both grayscale pixels when combining two RGB planes`, async () => {
        const pixels = Uint8Array.of(68, 68, 68, 85, 85, 85);
        const input = await sharp(pixels, { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/short.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/short.png", input);
        const args = ["/short.png", "/short.png", "-combine", "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([2, 1]);
        expect([...output.data]).toEqual([68, 68, 68, 255, 85, 85, 85, 255]);
    });
}
