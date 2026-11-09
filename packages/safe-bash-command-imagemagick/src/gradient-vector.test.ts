import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7 Q16 reference pixels, including padding past either endpoint.
const cases = [
    { vector: "0.5,0,2.5,0", input: "gradient", expected: [0, 64, 191, 255, 255, 0, 64, 191, 255, 255, 0, 64, 191, 255, 255] },
    { vector: "-1,0,3,0", input: "gradient", expected: [64, 128, 191, 255, 255, 64, 128, 191, 255, 255, 64, 128, 191, 255, 255] },
    { vector: "4,0,0,0", input: "gradient", expected: [255, 191, 128, 64, 64, 255, 191, 128, 64, 0, 255, 191, 128, 64, 0] },
    { vector: "0,0,2,0", input: "gradient", expected: [0,128,255,255,255,0,128,255,255,255,0,128,255,255,255] },
    { vector: "1,1,3,1", input: "gradient", expected: [0,0,128,255,255,0,0,128,255,255,0,0,128,255,255] },
    { vector: "0 0 4 2", input: "gradient", expected: [0,51,102,153,204,26,77,128,179,230,51,102,153,204,255] },
    { vector: "2,1,2,1", input: "gradient", expected: Array(15).fill(0) },
    { vector: "0,0,2,0", input: "radial-gradient", expected: [128,0,128,255,255,180,128,180,255,255,255,255,255,255,255] },
    { vector: "1,1,3,1", input: "radial-gradient", expected: [202,90,90,202,255,202,202,90,202,255,255,202,202,255,255] }
];
for (const retained of [false, true]) {
    it.each(cases)(`places $input vector=$vector (retained=${retained})`, async ({ vector, input, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", "5x3", "-define", `gradient:vector=${vector}`, `${input}:black-white`, "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const actual = Array.from(image.data).filter((_, i) => i % 4 === 0);
        expect(actual).toHaveLength(expected.length);
        actual.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1));
    });
    it.each([
        { options: ["-define", "gradient:direction=north"], expected: [0,128,255,255,255] },
        { options: ["-define", "gradient:angle=0"], expected: [255,255,255,255,255] },
        { options: ["+define", "gradient:vector"], expected: [0,0,0,0,0] }
    ])(`honors vector precedence/reset $options (retained=${retained})`, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", "5x3", "-define", "gradient:vector=0,0,2,0", ...options, "gradient:black-white", "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(image.data.slice(0,20)).filter((_, i) => i % 4 === 0)).toEqual(expected);
    });
}
