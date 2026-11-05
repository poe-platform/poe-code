import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Pixel values from ImageMagick 7.1.2, with 8-bit RGBA output.
const cases = [
    { name: "shared luminance with alpha", pixels: [32, 64, 128, 64, 160, 192, 224, 192], options: [], expected: [0, 4, 134, 4, 199, 255, 255, 255] },
    { name: "selected alpha channel", pixels: [32, 64, 128, 64, 160, 192, 224, 192], options: ["-channel", "A"], expected: [32, 64, 128, 0, 160, 192, 224, 255] },
    { name: "shared luminance", pixels: [32, 64, 128, 255, 160, 192, 224, 255], options: [], expected: [0, 4, 134, 255, 199, 255, 255, 255] },
    { name: "selected red channel", pixels: [32, 64, 128, 255, 160, 192, 224, 255], options: ["-channel", "R"], expected: [0, 64, 128, 255, 255, 192, 224, 255] },
    { name: "constant color", pixels: [32, 64, 128, 255], options: [], expected: [32, 64, 128, 255] }
];
for (const { name, pixels, options, expected } of cases) {
    it(`normalizes ${name} through buffered and retained paths`, async () => {
        const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: pixels.length / 4, height: 1, channels: 4 } }).png().toBuffer();
        const args = ["input", ...options, "-normalize", "out.png"];
        const files = new Map([["input", bytes]]);
        expect(await runConvertCli(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect([...decodeImage(files.get("out.png")!).data]).toEqual(expected);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file analysis forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect([...decodeImage(await fs.readFile("/out.png")).data]).toEqual(expected);
    });
}
