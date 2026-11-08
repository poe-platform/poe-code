import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["48x32+6+5", "90", "32x48+17+6"],
        ["48x32+6+5", "180", "48x32+28+17"],
        ["48x32+6+5", "270", "32x48+5+28"],
        ["48x32+6+5", "-90", "32x48+5+28"],
        ["48x32+6+5", "450", "32x48+17+6"],
        ["48x32+6+5", "360", "48x32+6+5"],
        ["48x32-6-5", "90", "32x48+27-6"],
        ["48x32-6-5", "180", "48x32+40+27"],
        ["48x32-6-5", "270", "32x48-5+40"],
        ["14x10+0+0", "90", "10x14+0+0"],
        ["14x10+0+0", "180", "14x10+0+0"],
        ["14x10+0+0", "270", "10x14+0+0"],
    ])(`rotates pixels and virtual canvas for %s %s (${mode})`, async (page, angle, expectedPage) => {
        const pixels = Uint8Array.from({ length: 14 * 10 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251);
        const input = await sharp(pixels, { raw: { width: 14, height: 10, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect((await run(["/input.png", "-repage", page, "/part.png"])).exitCode).toBe(0);
        const result = await run(["/part.png", "-rotate", angle, "/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect((await run(["identify", "-format", "%g", "/output.png"])).stdout).toBe(expectedPage);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        const rotation = ((Number(angle) % 360) + 360) % 360;
        const width = rotation % 180 === 0 ? 14 : 10, height = rotation % 180 === 0 ? 10 : 14;
        expect([output.width, output.height]).toEqual([width, height]);
        for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
            const targetX = rotation === 90 ? 9 - y : rotation === 180 ? 13 - x : rotation === 270 ? y : x;
            const targetY = rotation === 90 ? x : rotation === 180 ? 9 - y : rotation === 270 ? 13 - x : y;
            const target = (targetY * width + targetX) * 4, source = (y * 14 + x) * 4;
            expect(output.data.slice(target, target + 4)).toEqual(pixels.slice(source, source + 4));
        }
    });
}
