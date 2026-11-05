import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Pixel order verified with native ImageMagick 7.
const cases = [
    { geometry: "2x1", expected: [10, 20, 30, 40, 50, 60] },
    { geometry: "2", expected: [10, 20, 30, 40, 50, 60] },
    { geometry: "2x1+0+0", expected: [10, 20, 30, 40, 50, 60] },
    { geometry: "+2+1", expected: [50, 60, 40, 20, 30, 10] },
    { geometry: "2x1+0+1", expected: [40, 50, 60, 10, 20, 30] },
    { geometry: "2x1+1+0", expected: [30, 10, 20, 60, 40, 50] },
    { geometry: "-2-1", expected: [60, 40, 50, 30, 10, 20] },
    { geometry: "+5+3", expected: [50, 60, 40, 20, 30, 10] },
    { geometry: "+2", expected: [20, 30, 10, 50, 60, 40] },
    { geometry: "2x+1", expected: [30, 10, 20, 60, 40, 50] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`rolls only by offsets in $geometry, ${mode}`, async ({ geometry, expected }) => {
        const input = await sharp(Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(v => [v, v, v, 255])), { raw: { width: 3, height: 2, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-roll", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([3, 2]);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
    });
    it.each(["2+1", "2+1+0"])(`rejects invalid roll geometry %s, ${mode}`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:red", "-roll", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("invalid argument for option '-roll'");
    });
}
