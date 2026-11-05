import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

for (const retained of [false, true]) {
    it(`matches ImageMagick's perfect PSNR for identical PNGs, retained=${retained}`, async () => {
        const pixels = Uint8Array.from([16, 32, 64, 54, 70, 99, 93, 109, 134, 208, 224, 240]);
        const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["a.png", png]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", png);
        const input = retained ? { filesystem, cwd: "/" } : files;
        // ImageMagick 7.1.2 Q16-HDRI reports a capped PSNR and status 1.
        expect(await runCompareCli(["-metric", "PSNR", "a.png", "a.png", "null:"], input))
            .toMatchObject({ exitCode: 1, stdout: "", stderr: "120 (1)\n" });
        expect(await runCompareCli(["-metric", "RMSE", "a.png", "a.png", "null:"], input))
            .toMatchObject({ exitCode: 0, stdout: "", stderr: "0 (0)\n" });
    });
}
