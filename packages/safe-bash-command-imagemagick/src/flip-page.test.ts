import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["48x32+6+5", "-flip", "48x32+6+17"],
        ["48x32+6+5", "-flop", "48x32+28+5"],
        ["48x32-6-5", "-flip", "48x32-6+27"],
        ["48x32-6-5", "-flop", "48x32+40-5"],
        ["14x10+0+0", "-flip", "14x10+0+0"],
        ["14x10+0+0", "-flop", "14x10+0+0"],
    ])(`mirrors pixels and page position for %s %s (${mode})`, async (page, operation, expectedPage) => {
        const pixels = Uint8Array.from({ length: 14 * 10 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251);
        const input = await sharp(pixels, { raw: { width: 14, height: 10, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect((await run(["/input.png", "-repage", page, "/part.png"])).exitCode).toBe(0);
        const result = await run(["/part.png", operation, "/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect((await run(["identify", "-format", "%g", "/output.png"])).stdout).toBe(expectedPage);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([14, 10]);
        for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
            const source = ((operation === "-flip" ? 9 - y : y) * 14 + (operation === "-flop" ? 13 - x : x)) * 4;
            expect(output.data.slice((y * 14 + x) * 4, (y * 14 + x + 1) * 4)).toEqual(pixels.slice(source, source + 4));
        }
    });
}
