import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick 7 Q16-HDRI, 9x1 grayscale impulse resized to 27x1.
    it.each([
        ["Bartlett", [32, 32, 31, 29, 32, 39, 42, 32, 12, 4, 32, 103, 188, 224, 188, 103, 32, 4, 12, 32, 42, 39, 32, 29, 31, 32, 32]],
        ["Blackman", [32, 32, 32, 32, 32, 35, 37, 32, 17, 7, 32, 103, 186, 224, 186, 103, 32, 7, 17, 32, 37, 35, 32, 32, 32, 32, 32]],
        ["Bohman", [32, 32, 32, 32, 32, 34, 37, 32, 17, 8, 32, 102, 186, 224, 186, 102, 32, 8, 17, 32, 37, 34, 32, 32, 32, 32, 32]],
        ["Cosine", [32, 32, 32, 32, 32, 36, 40, 32, 12, 1, 32, 107, 189, 224, 189, 107, 32, 1, 12, 32, 40, 36, 32, 32, 32, 32, 32]],
        ["Hamming", [32, 32, 31, 30, 32, 38, 42, 32, 11, 2, 32, 107, 189, 224, 189, 107, 32, 2, 11, 32, 42, 38, 32, 30, 31, 32, 32]],
        ["Hann", [32, 32, 32, 31, 32, 37, 41, 32, 12, 2, 32, 106, 188, 224, 188, 106, 32, 2, 12, 32, 41, 37, 32, 31, 32, 32, 32]],
        ["Kaiser", [32, 32, 32, 31, 32, 37, 40, 32, 14, 4, 32, 105, 187, 224, 187, 105, 32, 4, 14, 32, 40, 37, 32, 31, 32, 32, 32]],
        ["Parzen", [32, 32, 32, 32, 32, 34, 35, 32, 19, 10, 32, 101, 185, 224, 185, 101, 32, 10, 19, 32, 35, 34, 32, 32, 32, 32, 32]],
        ["Welch", [32, 32, 32, 32, 32, 36, 41, 32, 10, 0, 32, 108, 189, 224, 189, 108, 32, 0, 10, 32, 41, 36, 32, 32, 32, 32, 32]],
        ["Mitchell", [32, 32, 32, 32, 32, 32, 32, 32, 28, 26, 43, 98, 168, 203, 168, 98, 43, 26, 28, 32, 32, 32, 32, 32, 32, 32, 32]],
        ["Lanczos", [32, 32, 32, 32, 32, 35, 38, 32, 14, 4, 32, 105, 188, 224, 188, 105, 32, 4, 14, 32, 38, 35, 32, 32, 32, 32, 32]],
        ["Point", [32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 224, 224, 224, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32]]
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
            ["Bartlett", [135, 19, 37, 31, 32]],
            ["Blackman", [134, 20, 35, 32, 32]],
            ["Bohman", [134, 20, 34, 32, 32]],
            ["Cosine", [135, 18, 36, 32, 32]],
            ["Hamming", [135, 18, 37, 31, 32]],
            ["Hann", [135, 18, 36, 31, 32]],
            ["Kaiser", [135, 19, 36, 31, 32]],
            ["Parzen", [134, 21, 34, 32, 32]],
            ["Welch", [135, 17, 36, 32, 32]],
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

    it(`${mode}: rejects an unknown resize filter without publishing output`, async () => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: 9, height: 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/impulse.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/impulse.png", input);
        const args = ["/impulse.png", "-filter", "InvalidName", "-resize", "27x1!", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unrecognized image filter 'InvalidName'");
        expect(result.stdout).toBe("");
        expect(result.stdoutBytes).toBeUndefined();
        expect([...files.keys()]).toEqual(["/impulse.png"]);
        expect(await filesystem.readdir("/")).toEqual([{ name: "impulse.png", type: "file" }]);
    });
}
