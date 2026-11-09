import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each(["bogus", "1x1: bogus"])(`-color-matrix validates %s without destroying output, retained=${retained}`, async (matrix) => {
        const input = await sharp(new Uint8Array([25, 100, 220, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const destination = await sharp(new Uint8Array([255, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", input], ["/out.png", destination]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", destination);
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (matrix === "bogus") {
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("Invalid color matrix");
            expect(output).toEqual(destination);
        } else {
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(output).data]).toEqual([0, 100, 220, 128]);
        }
    });
}
