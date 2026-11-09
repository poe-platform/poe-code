import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

for (const retained of [false, true]) {
    it(`matches ImageMagick's PSNR for differing PNGs, retained=${retained}`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        for (const [name, alpha] of [["a.png", 0.2], ["b.png", 0.8]] as const) {
            const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha } } }).png().toBuffer();
            files.set(name, png);
            await filesystem.writeFile(`/${name}`, png);
        }
        const input = retained ? { filesystem, cwd: "/" } : files;
        expect(await runCompareCli(["-metric", "PSNR", "a.png", "b.png", "null:"], input))
            .toMatchObject({ exitCode: 1, stdout: "", stderr: "7.44727 (0.0620606)" });
    });

    it(`matches ImageMagick's perfect PSNR for identical PNGs, retained=${retained}`, async () => {
        const pixels = Uint8Array.from([16, 32, 64, 54, 70, 99, 93, 109, 134, 208, 224, 240]);
        const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["a.png", png]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", png);
        const input = retained ? { filesystem, cwd: "/" } : files;
        // ImageMagick 7.1.2 Q16-HDRI reports a capped PSNR and status 1.
        expect(await runCompareCli(["-metric", "PSNR", "a.png", "a.png", "null:"], input))
            .toMatchObject({ exitCode: 1, stdout: "", stderr: "120 (1)" });
        expect(await runCompareCli(["-metric", "RMSE", "a.png", "a.png", "null:"], input))
            .toMatchObject({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    });
}

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });
it.skipIf(native.error !== undefined)("matches native ImageMagick PSNR for differing alpha", async () => {
    const images = await Promise.all([0.2, 0.8].map(alpha => sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha } } }).png().toBuffer()));
    const result = spawnSync("magick", ["compare", "-metric", "PSNR", ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("7.44727 (0.0620606)");
});
