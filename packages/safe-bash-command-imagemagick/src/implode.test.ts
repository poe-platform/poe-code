import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { options: [], expected: [10, 20, 30, 40, 26, 42, 70, 74, 90] },
        { options: ["-virtual-pixel", "edge"], expected: [10, 20, 30, 40, 26, 42, 70, 74, 90] },
        { options: ["-virtual-pixel", "black", "+virtual-pixel"], expected: [10, 20, 30, 40, 26, 42, 70, 74, 90] },
        { options: ["-virtual-pixel", "background"], expected: [10, 20, 30, 40, 26, 170, 70, 182, 228] },
        { options: ["-virtual-pixel", "black"], expected: [10, 20, 30, 40, 26, 17, 70, 30, 15] },
        { options: ["-virtual-pixel", "white"], expected: [10, 20, 30, 40, 26, 170, 70, 182, 228] },
        { options: ["-virtual-pixel", "gray"], expected: [10, 20, 30, 40, 26, 93, 70, 106, 121] },
        { options: ["-virtual-pixel", "tile"], expected: [10, 20, 30, 40, 26, 30, 70, 38, 42] },
        { options: ["-virtual-pixel", "mirror"], expected: [10, 20, 30, 40, 26, 42, 70, 74, 90] }
    ])(`matches native implode virtual pixels via ${mode}: $options`, async ({ options, expected }) => {
        // ImageMagick 7.1.2: 3x3 opaque grayscale RGBA input, -implode 2 -depth 8 rgba:-.
        const pixels = Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90].flatMap(v => [v, v, v, 255]));
        const input = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...options, "-implode", "2", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([3, 3]);
        const rgba = expected.flatMap(v => [v, v, v, 255]);
        // Native gray is half-quantum; our byte samples round it to 128.
        if (options[1] === "gray") {
            for (let i = 0; i < rgba.length; i++) expect(Math.abs(output.data[i]! - rgba[i]!)).toBeLessThanOrEqual(1);
        } else expect([...output.data]).toEqual(rgba);
    });
}
