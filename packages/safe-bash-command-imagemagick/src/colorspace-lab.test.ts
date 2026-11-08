import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const input = encodeImage({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

for (const retained of [false, true]) {
    it.each(["Lab", "lab", "LAB"])(`rejects %s from truecolor PNG without changing TIFF, retained=${retained}`, async space => {
        const decoded = decodeImage(input);
        expect(decoded.channels).toBe(3);
        expect(decoded.space).toBe("srgb");
        expect([...decoded.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
        const fs = new MemoryFileSystem();
        const original = new Uint8Array([1, 2, 3]);
        const files = new Map<string, Uint8Array>([["out.tiff", original]]);
        await fs.writeFile("/out.tiff", original);
        const context = retained ? { filesystem: fs, cwd: "/" } : files;
        for (const output of ["out.tiff", "tiff:-"]) {
            const result = await runConvertCli(["png:-", "-colorspace", space, output], context, input);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("unsupported colorspace 'Lab'");
            expect(result.stdout).toBe("");
        }
        expect(retained ? await fs.readFile("/out.tiff") : files.get("out.tiff")).toEqual(original);
    });
}

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.skipIf(!nativeAvailable)("confirms the Lab TIFF reference colorspace, channels and pixels", () => {
    const native = spawnSync("magick", ["png:-", "-colorspace", "Lab", "tiff:-"], { input });
    expect(native.status).toBe(0);
    const metadata = spawnSync("magick", ["identify", "-format", "%[colorspace] %[channels]", "tiff:-"], { input: native.stdout, encoding: "utf8" });
    expect(metadata.status).toBe(0);
    expect(metadata.stdout.trim()).toBe("CIELab cielab  3.0");
    const pixels = spawnSync("magick", ["tiff:-", "-colorspace", "sRGB", "-depth", "8", "rgb:-"], { input: native.stdout });
    expect(pixels.status).toBe(0);
    // Lab TIFF quantization varies with the native ImageMagick version.
    expect(pixels.stdout).toHaveLength(6);
    [255, 0, 0, 0, 0, 255].forEach((value, index) => {
        expect(Math.abs(pixels.stdout[index]! - value)).toBeLessThanOrEqual(16);
    });
});
