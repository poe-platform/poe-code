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
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`detects native Canny edges via ${mode}: $geometry`, async ({ geometry, rows }) => {
        const pixels = new Uint8Array(5 * 5 * 4);
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
        pixels.fill(255, 12 * 4, 13 * 4);
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
