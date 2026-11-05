import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI results for these exact 3x2 RGBA PNGs.
for (const retained of [false, true]) {
    for (const [name, a, b, metric, stderr, exitCode] of [
        ["changed alpha", { r: 255, g: 0, b: 0, alpha: 0.2 }, { r: 255, g: 0, b: 0, alpha: 0.8 }, "NCC", "0 (0)", 0],
        ["changed alpha", { r: 255, g: 0, b: 0, alpha: 0.2 }, { r: 255, g: 0, b: 0, alpha: 0.8 }, "SSIM", "4336.24 (0.0661667)", 1],
        ["transparent colors", { r: 255, g: 0, b: 0, alpha: 0 }, { r: 0, g: 0, b: 255, alpha: 0 }, "NCC", "32767.5 (0.5)", 1],
        ["transparent colors", { r: 255, g: 0, b: 0, alpha: 0 }, { r: 0, g: 0, b: 255, alpha: 0 }, "SSIM", "16382.1 (0.249975)", 1],
        ["identical solids", { r: 255, g: 0, b: 0, alpha: 1 }, { r: 255, g: 0, b: 0, alpha: 1 }, "NCC", "32767.5 (0.5)", 1],
        ["identical solids", { r: 255, g: 0, b: 0, alpha: 1 }, { r: 255, g: 0, b: 0, alpha: 1 }, "SSIM", "0 (0)", 0],
        ["below status tolerance", { r: 255, g: 0, b: 0, alpha: 1 }, { r: 254, g: 0, b: 0, alpha: 1 }, "SSIM", "0.0632345 (9.64897e-07)", 0],
        ["above status tolerance", { r: 255, g: 0, b: 0, alpha: 1 }, { r: 253, g: 0, b: 0, alpha: 1 }, "SSIM", "0.253932 (3.87475e-06)", 1]
    ] as const) {
        it(`matches native ${metric} status for ${name}, retained=${retained}`, async () => {
            const [aBytes, bBytes] = await Promise.all([a, b].map(background =>
                sharp({ create: { width: 3, height: 2, channels: 4, background } }).png().toBuffer()));
            const files = new Map([["a.png", aBytes!], ["b.png", bBytes!]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files)
                await filesystem.writeFile(`/${name}`, bytes);
            const result = await runCompareCli(["-metric", metric, "a.png", "b.png", "null:"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.stderr).toBe(`${stderr}\n`);
            expect(result.exitCode).toBe(exitCode);
        });
    }
}
