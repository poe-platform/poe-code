import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it(`converts real PNG pixels to HSL and back, retained=${retained}`, async () => {
        const pixels = [32, 64, 96, 128, 255, 0, 0, 255, 128, 128, 128, 255, 0, 255, 0, 255, 0, 0, 255, 255];
        const { data } = encodeImage({ width: 5, height: 1, data: Uint8Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const format = "%[colorspace] %[fx:p{0,0}.r] %[fx:p{0,0}.g] %[fx:p{0,0}.b] %[pixel:p{1,0}]";
        const args = ["in.png", "-colorspace", "HSL", "-format", format, "info:"];
        const result = await runConvertCli(args, input);
        expect(result.exitCode, result.stderr).toBe(0);
        const fields = result.stdout.trim().split(" ");
        expect(fields[0]).toBe("HSL");
        expect(Number(fields[1])).toBeCloseTo(210 / 360, 4);
        expect(Number(fields[2])).toBeCloseTo(0.5, 4);
        expect(Number(fields[3])).toBeCloseTo(64 / 255, 4);
        expect(fields[4]).toBe("hsla(0,100%,50%,1)");
        const native = spawnSync("magick", ["png:-", ...args.slice(1)], { input: data, encoding: "utf8" });
        if (!native.error) {
            expect(native.status, native.stderr).toBe(0);
            expect(result.stdout.trim()).toBe(native.stdout.trim());
            const values = native.stdout.split(" ");
            for (let i = 1; i <= 3; i++) expect(Number(fields[i])).toBeCloseTo(Number(values[i]), 4);
        }
        for (const format of ["png", "tiff"]) {
            const output = await runConvertCli(["in.png", "-colorspace", "HSL", `out.${format}`], input);
            expect(output.exitCode, output.stderr).toBe(0);
            const encoded = retained ? await fs.readFile(`/out.${format}`) : files.get(`out.${format}`)!;
            const decoded = decodeImage(encoded);
            expect([...decoded.data.slice(0, 4)]).toEqual(format === "png" ? pixels.slice(0, 4) : [149, 128, 64, 128]);
        }
        for (const output of ["txt:-", "histogram:-"]) {
            const text = await runConvertCli(["in.png", "-colorspace", "HSL", output], input);
            expect(text.exitCode, text.stderr).toBe(0);
            expect(text.stdout).toContain("hsla(210.001,50.0008%,25.098%,0.501961)");
            expect(text.stdout).not.toContain("srgb");
        }
        const written = await runConvertCli(["in.png", "-colorspace", "HSL", "-write", "written.png", "-format", "%[colorspace]", "info:"], input);
        expect(written.stdout.trim()).toBe("HSL");
        expect([...decodeImage(retained ? await fs.readFile("/written.png") : files.get("written.png")!).data]).toEqual(pixels);
        const reported = await runConvertCli(["in.png", "-colorspace", "HSL", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
        expect(reported.stdout.trim()).toBe("hsla(210,50%,25.098%,0.501961) HSL");
        const repeated = await runConvertCli(["in.png", "-colorspace", "HSL", "-colorspace", "HSL", "-format", format, "info:"], input);
        expect(repeated.stdout).toBe(result.stdout);
        const roundtrip = await runConvertCli(["in.png", "-colorspace", "HSL", "-colorspace", "sRGB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
        expect(roundtrip.stdout.trim()).toBe("srgba(32,64,96,0.501961) sRGB");
    });
}

for (const retained of [false, true]) {
    it(`reports opaque and achromatic HSL, retained=${retained}`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        for (const [color, expected] of [["red", "hsla(0,100%,50%,1)"], ["black", "hsla(0,0%,0%,1)"], ["white", "hsla(0,0%,100%,1)"], ["blue", "hsla(240,100%,50%,1)"], ["lime", "hsla(120,100%,50%,1)"]]) {
            const result = await runConvertCli(["-size", "1x1", `xc:${color}`, "-colorspace", "HSL", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stdout.trim()).toBe(`${expected} HSL`);
        }
    });
}
