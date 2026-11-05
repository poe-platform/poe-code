import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-32: 5x5 black PNG with a white point at (2,2),
// -canny <geometry> -depth 8 gray:-.
const cases = [
    { geometry: "0x1+10%+110%", rows: ["00000", "00000", "00000", "00000", "00000"] },
    { geometry: "0x1+10%+30%", rows: ["00000", "01100", "01100", "00000", "00000"] },
    { geometry: "0x2+10%+30%", rows: ["11111", "10010", "10010", "11111", "10010"] },
];
// Opaque 5x5 grayscale patterns, verified with ImageMagick 7.1.2-31 Q16-HDRI
// at 0x1+10%+30%; checkerboard also matches the 7.1.2-32 reproduction.
const patterns = [
    { name: "checkerboard", pixel: (x: number, y: number) => (x + y) % 2 === 0 ? 255 : 0, rows: ["10001", "00000", "00000", "00011", "10010"] },
    { name: "vertical split", pixel: (x: number) => x < 2 ? 0 : 255, rows: ["01000", "01000", "01000", "01000", "01000"] },
    { name: "diagonal", pixel: (x: number, y: number) => x === y ? 255 : 0, rows: ["10100", "00110", "11000", "01011", "00010"] },
    { name: "ramp", pixel: (x: number, y: number) => (x * 47 + y * 83) % 256, rows: ["10011", "00000", "10000", "00111", "00010"] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ...cases.map(test => ({ ...test, name: "point", pixel: (x: number, y: number) => x === 2 && y === 2 ? 255 : 0 })),
        ...patterns.map(test => ({ ...test, geometry: "0x1+10%+30%" })),
    ])(`detects native Canny edges via ${mode}: $name $geometry`, async ({ geometry, rows, pixel }) => {
        const pixels = new Uint8Array(5 * 5 * 4);
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
        for (let i = 0; i < 25; i++) pixels.fill(pixel(i % 5, Math.floor(i / 5)), i * 4, i * 4 + 3);
        const input = await sharp(pixels, { raw: { width: 5, height: 5, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-canny", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...rows.join("")].flatMap(bit => {
            const value = Number(bit) * 255;
            return [value, value, value, 255];
        }));
    });
}
