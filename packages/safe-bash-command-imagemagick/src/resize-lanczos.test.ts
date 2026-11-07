import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick 7 Q16-HDRI, 9x1 grayscale impulse resized to 27x1.
    it.each([
        ["Lanczos2", [32, 32, 32, 32, 32, 32, 32, 32, 26, 16, 32, 97, 181, 224, 181, 97, 32, 16, 26, 32, 32, 32, 32, 32, 32, 32, 32]],
        ["Lanczos2Sharp", [32, 32, 32, 32, 32, 32, 32, 32, 28, 16, 26, 91, 184, 235, 184, 91, 26, 16, 28, 32, 32, 32, 32, 32, 32, 32, 32]],
        ["LanczosSharp", [32, 32, 32, 32, 32, 34, 38, 33, 16, 3, 29, 104, 190, 227, 190, 104, 29, 3, 16, 33, 38, 34, 32, 32, 32, 32, 32]]
    ])(`${mode}: preserves the %s resize filter`, async (filter, expected) => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: 9, height: 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/impulse.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/impulse.png", input);
        const args = ["/impulse.png", "-filter", filter.toLowerCase(), "-resize", "27x1!", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([27, 1]);
        expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });

    for (const vertical of [false, true]) {
        // Native ImageMagick: an edge impulse reduced along either axis.
        it.each([
            ["Lanczos2", [134, 23, 32, 32, 32]],
            ["Lanczos2Sharp", [136, 22, 32, 32, 32]],
            ["LanczosSharp", [136, 18, 35, 32, 32]],
        ])(`${mode}: reduces an edge impulse with %s (vertical=${vertical})`, async (filter, expected) => {
            const input = await sharp(Uint8Array.from([224, 32, 32, 32, 32, 32, 32, 32, 32]), {
                raw: { width: vertical ? 1 : 9, height: vertical ? 9 : 1, channels: 1 }
            }).png().toBuffer();
            const files = new Map([["/impulse.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/impulse.png", input);
            const args = ["/impulse.png", "-filter", filter, "-resize", vertical ? "1x5!" : "5x1!", "/out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual(vertical ? [1, 5] : [5, 1]);
            expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        });
    }

}
