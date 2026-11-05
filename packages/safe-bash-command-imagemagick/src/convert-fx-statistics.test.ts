import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// RGBA8 controls from ImageMagick 7.1.2-32, including its zero red statistic.
const cases = [
    { expression: "mean", pixels: [64, 128, 192, 80], expected: [0, 116, 116, 116] },
    { expression: "mean.g", pixels: [64, 128, 192, 80], expected: [0, 128, 128, 128] },
    { expression: "mean.b", pixels: [64, 128, 192, 80], expected: [0, 192, 192, 192] },
    { expression: "standard_deviation", pixels: [64, 128, 192, 80], expected: [0, 0, 0, 0] },
    { expression: "mean", pixels: [64, 128, 192, 80, 128, 64, 0, 160], expected: [0, 102, 102, 102, 0, 102, 102, 102] },
    { expression: "standard_deviation.g", pixels: [64, 128, 192, 80, 128, 64, 0, 160], expected: [0, 45, 45, 45, 0, 45, 45, 45] },
    { expression: "mean+0.1", pixels: [64, 128, 192, 80], expected: [26, 142, 142, 142] },
    { expression: "mean", pixels: Array.from({ length: 1025 }, () => [64, 128, 192, 80, 128, 64, 0, 160]).flat(), expected: Array.from({ length: 2050 }, () => [0, 102, 102, 102]).flat() },
    { expression: "mean", channel: "G", pixels: [64, 128, 192, 80], expected: [64, 128, 192, 80] },
    { expression: "mean.g", channel: "B", pixels: [64, 128, 192, 80], expected: [64, 128, 0, 80] },
];

it.each([false, true].flatMap(retained => cases.map(test => ({ ...test, retained }))))(
    "evaluates $expression with channel $channel (retained=$retained)",
    async ({ expression, pixels, expected, channel, retained }) => {
        const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: pixels.length / 4, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file statistics I/O forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await runConvertCli(["/input", ...(channel ? ["-channel", channel] : []), "-fx", expression, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data)).toEqual(expected);
    }
);
