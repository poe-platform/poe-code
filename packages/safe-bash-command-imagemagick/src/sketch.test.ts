import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, RGB input, -seed 123 -sketch <geometry>.
const cases = [
    { geometry: "0x1+45", pixels: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        64, 64, 64, 50, 50, 50, 182, 182, 182, 122, 122, 122, 67, 67, 67, 60, 60, 60, 62, 62, 62, 204, 204, 204,
        112, 112, 112, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 104, 104, 104, 255, 255, 255,
        156, 156, 156, 186, 186, 186, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 180, 180, 180, 208, 208, 208,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 188, 188, 188, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 219, 219, 219, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ] },
    { geometry: "0x2+45", pixels: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        62, 62, 62, 50, 50, 50, 164, 164, 164, 118, 118, 118, 80, 80, 80, 70, 70, 70, 106, 106, 106, 214, 214, 214,
        95, 95, 95, 187, 187, 187, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 107, 107, 107, 255, 255, 255,
        204, 204, 204, 161, 161, 161, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 149, 149, 149, 220, 220, 220,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 166, 166, 166, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 223, 223, 223, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ] },
    { geometry: "2x2+45", pixels: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        62, 62, 62, 50, 50, 50, 165, 165, 165, 119, 119, 119, 79, 79, 79, 70, 70, 70, 103, 103, 103, 211, 211, 211,
        96, 96, 96, 191, 191, 191, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 106, 106, 106, 255, 255, 255,
        216, 216, 216, 155, 155, 155, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 147, 147, 147, 221, 221, 221,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 164, 164, 164, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 222, 222, 222, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ] },
    { geometry: "0x2+135", pixels: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        79, 79, 79, 50, 50, 50, 109, 109, 109, 255, 255, 255, 85, 85, 85, 84, 84, 84, 71, 71, 71, 128, 128, 128,
        96, 96, 96, 203, 203, 203, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        211, 211, 211, 171, 171, 171, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 188, 188, 188, 151, 151, 151,
        255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 224, 224, 224, 255, 255, 255,
        255, 255, 255, 228, 228, 228, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 219, 219, 219, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ] }
];
for (const retained of [false, true]) it.each(cases)(`matches seeded sketch $geometry (retained=${retained})`, async ({ geometry, pixels }) => {
    const input = Uint8Array.from({ length: 256 }, (_, i) => {
        const p = i >> 2, x = p % 8, y = p >> 3, channel = i % 4;
        return channel === 3 ? 255 : x >= 2 && x <= 5 && y >= 2 && y <= 5 ? (channel === 0 ? 255 : 0) : Math.round(y * 255 / 7);
    });
    const png = await sharp(input, { raw: { width: 8, height: 8, channels: 4 } }).removeAlpha().png().toBuffer();
    const files = new Map([["input.png", png]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", png);
    const result = await runConvertCli(["input.png", "-seed", "123", "-sketch", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    const rgb = [...output.data].filter((_, i) => i % 4 !== 3);
    expect(rgb).toEqual(pixels);
});

it("repeats a seed and changes strokes when the seed changes", async () => {
    const files = new Map<string, Uint8Array>();
    for (const [seed, output] of [[123, "first.png"], [456, "second.png"], [123, "repeat.png"]] as const) {
        expect((await runConvertCli(["-size", "8x8", "gradient:black-white", "-seed", String(seed), "-sketch", "0x2+45", output], files)).exitCode).toBe(0);
    }
    expect(decodeImage(files.get("first.png")!).data).toEqual(decodeImage(files.get("repeat.png")!).data);
    expect(decodeImage(files.get("first.png")!).data).not.toEqual(decodeImage(files.get("second.png")!).data);
});

for (const retained of [false, true]) it.each([
    ["-seed", "NaN"], ["-seed", "1.5"], ["-sketch", "5001x1"], ["-sketch", "0x1000000"]
])(`rejects invalid seeds and excessive kernels (retained=${retained}): %s %s`, async (option, value) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const result = await runConvertCli(["-size", "1x1", "xc:white", option, value, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).not.toBe(0);
    expect(files.has("out.png")).toBe(false);
    await expect(fs.stat("/out.png")).rejects.toThrow();
});
