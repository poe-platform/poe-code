import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

const rotate = "3x3:0,1,0,0,0,1,1,0,0";
const identity = "3x3:1,0,0,0,1,0,0,0,1";
for (const retained of [false, true]) {
    it.each([
        { matrix: `${rotate};${identity}`, expected: [95, 163, 32, 128] },
        { matrix: `${identity};${rotate}`, expected: [32, 95, 163, 128] },
        { matrix: `${rotate};Unity;${identity}`, expected: [95, 163, 32, 128] },
    ])(`uses only the first color kernel: $matrix, retained=${retained}`, async ({ matrix, expected }) => {
        const bytes = await sharp(new Uint8Array([32, 95, 163, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "PNG32:/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
    });

    it.each([`${rotate};bogus`, `${rotate};${identity};bogus`, `${rotate};2x2:1,0,1`, `bogus;${identity}`])(`validates every color kernel before publishing: %s, retained=${retained}`, async matrix => {
        const bytes = await sharp(new Uint8Array([32, 95, 163, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", bytes], ["/out.png", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        await fs.writeFile("/out.png", keep);
        const result = await runMagickCli(["/in.png", "-color-matrix", matrix, "PNG32:/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid color matrix");
        expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(keep);
    });
}
