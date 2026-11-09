import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "retained", "sync"] as const)("expands vignette insets against each source image (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const run = async (args: string[]) => {
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
    };
    const read = async (path: string) => decodeImage(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!).data;
    for (const geometry of ["0x0+%[fx:w-7]+2", "0x0+%[fx:2]+2"]) {
        await run(["-size", "9x9", "xc:#b4326480", "-size", "11x9", "xc:#b4326480", "-background", "#20304080", "-compose", "Over", "-vignette", geometry, "/actual-%d.png"]);
        for (const [index, width] of [9, 11].entries()) {
            const inset = geometry.includes("w-7") ? width - 7 : 2;
            await run(["-size", `${width}x9`, "xc:#b4326480", "-background", "#20304080", "-compose", "Over", "-vignette", `0x0+${inset}+2`, "/expected.png"]);
            expect(await read(`/actual-${index}.png`)).toEqual(await read("/expected.png"));
            if (width === 9) {
                const pixels = await read(`/actual-${index}.png`);
                // Native ImageMagick 7.1.2 Q16-HDRI RGBA8 reference pixels.
                expect(Array.from(pixels.slice(0, 4))).toEqual([32, 48, 64, 128]);
                expect(Array.from(pixels.slice((2 * 9 + 4) * 4, (2 * 9 + 5) * 4))).toEqual([180, 50, 100, 255]);
            }
        }
    }
});

it.each(["buffered", "retained", "sync"] as const)("rejects non-geometry vignette arguments without writing output (%s)", async mode => {
    for (const geometry of ["junk", "0x1junk", "NaN", "", " "]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "20x16", "xc:#3060a080", "-vignette", geometry, "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, geometry).toBe(1);
        expect(result.stderr).toContain("invalid argument for option '-vignette'");
        expect(files.has("/output.png")).toBe(false);
        await expect(filesystem.readFile("/output.png")).rejects.toMatchObject({ code: "ENOENT" });
    }
});
