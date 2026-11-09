import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([0, 128, 255])(`-color-matrix applies constant offsets independently of alpha=%i, retained=${retained}`, async (alpha) => {
        const bytes = await sharp(new Uint8Array([25, 100, 220, alpha]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const matrix = "1 0 0 0 0 0.25 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1";
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([89, 100, 220, alpha]);
    });
}
