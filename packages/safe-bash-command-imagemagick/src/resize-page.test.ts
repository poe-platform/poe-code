import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Expected geometry from native ImageMagick, including CloneImage offset rounding.
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const [operation, filter] of [["-sample", "Lanczos"], ["-scale", "Lanczos"], ["-resize", "Lanczos"], ["-resize", "Triangle"]] as const) {
        it.each([
            ["48x32+6+5", "50%", "7x5 24x16+3+2"],
            ["48x32-6-5", "50%", "7x5 24x16-3-3"],
            ["49x33+7+5", "50%", "7x5 25x17+3+2"],
            ["48x32+6+5", "21x20!", "21x20 72x64+9+7"],
            ["48x32+6+5", "42x10!", "42x10 144x32+18+5"],
            ["48x32+6+5", "14x10!", "14x10 48x32+6+5"],
            ["14x10+0+0", "50%", "7x5 7x5+0+0"],
        ])(`${operation} (${filter}) scales page %s to %s (${mode})`, async (page, geometry, expected) => {
            const pixels = Uint8Array.from({ length: 14 * 10 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251);
            const input = await sharp(pixels, { raw: { width: 14, height: 10, channels: 4 } }).png().toBuffer();
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
                : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect((await run(["/input.png", "-repage", page, "/part.png"])).exitCode).toBe(0);
            const result = await run(["/part.png", "-filter", filter, operation, geometry, "/output.png"]);
            expect(result.exitCode, result.stderr).toBe(0);
            expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(expected);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            expect((await run(["/input.png", "-filter", filter, operation, geometry, "/control.png"])).exitCode).toBe(0);
            const control = decodeImage(mode === "retained" ? await filesystem.readFile("/control.png") : files.get("/control.png")!);
            expect(output.data).toEqual(control.data);
        });
    }
}
