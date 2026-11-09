import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick 7 reference samples for a non-square image.
const cases = [
    {"define": "direction=east", "expected": [0, 64, 128, 191, 255, 0, 64, 128, 191, 255, 0, 64, 128, 191, 255]},
    {"define": "direction=north", "expected": [255, 255, 255, 255, 255, 128, 128, 128, 128, 128, 0, 0, 0, 0, 0]},
    {"define": "direction=south", "expected": [0, 0, 0, 0, 0, 128, 128, 128, 128, 128, 255, 255, 255, 255, 255]},
    {"define": "direction=northeast", "expected": [51, 102, 153, 204, 255, 26, 77, 128, 179, 230, 0, 51, 102, 153, 204]},
    {"define": "direction=southeast", "expected": [0, 51, 102, 153, 204, 26, 77, 128, 179, 230, 51, 102, 153, 204, 255]},
    {"define": "angle=0", "expected": [255, 255, 255, 255, 255, 128, 128, 128, 128, 128, 0, 0, 0, 0, 0]},
    {"define": "angle=30", "expected": [118, 153, 187, 221, 255, 59, 93, 128, 162, 196, 0, 34, 68, 102, 137]},
    {"define": "angle=45", "expected": [85, 128, 170, 213, 255, 43, 85, 128, 170, 213, 0, 43, 85, 128, 170]},
    {"define": "angle=90", "expected": [0, 64, 128, 191, 255, 0, 64, 128, 191, 255, 0, 64, 128, 191, 255]},
    {"define": "angle=180", "expected": [0, 0, 0, 0, 0, 128, 128, 128, 128, 128, 255, 255, 255, 255, 255]}
];
for (const retained of [false, true]) {
    it.each(cases)(`honors gradient:$define (retained=${retained})`, async ({ define, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", "5x3", "-define", `gradient:${define}`, "gradient:black-white", "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const actual = Array.from(image.data).filter((_, i) => i % 4 === 0);
        // Native Q16 output can differ by one after conversion to 8-bit.
        actual.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1));
    });
}

for (const retained of [false, true]) {
    it.each([
        { options: ["-define", "gradient:direction=east", "-define", "gradient:angle=0"], expected: [255, 255, 255, 255, 255] },
        { options: ["-define", "gradient:angle=0", "-define", "gradient:direction=east", "+define", "gradient:angle"], expected: [0, 64, 128, 191, 255] },
        { options: ["-define", "gradient:direction=east", "+define", "gradient:direction"], expected: [0, 0, 0, 0, 0] }
    ])(`honors define precedence and reset $options (retained=${retained})`, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", "5x3", ...options, "gradient:black-white", "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(image.data.slice(0, 20)).filter((_, i) => i % 4 === 0)).toEqual(expected);
    });
}
