import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI grayscale impulse reference rows.
import fixtures from "./resize-defines-fixtures.json" with { type: "json" };

for (const { filter, defines, target, expected } of fixtures) for (const vertical of [false, true]) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it(`matches the complete native ${filter} ${defines.join(",")} impulse to ${target}: ${mode}, vertical=${vertical}`, async () => {
            const pixels = Uint8Array.from(Array.from({ length: 9 }, (_, i) => Array(3).fill(i === 4 ? 224 : 32)).flat());
            const input = await sharp(pixels, { raw: { width: vertical ? 1 : 9, height: vertical ? 9 : 1, channels: 3 } }).png().toBuffer();
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["png:-", "-filter", filter, ...defines.flatMap(value => ["-define", value]), "-resize", vertical ? `1x${target}!` : `${target}x1!`, ...defines.flatMap(value => ["+define", value.split("=")[0]!]), "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files, input)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        });
    }
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const define of ["filter:b=1", "filter:c=0.5", "filter:sigma=0.8", "filter:window=Hann"]) {
        it(`clears ${define} before resizing: ${mode}`, async () => {
            const pixels = Uint8Array.from(Array.from({ length: 9 }, (_, i) => Array(3).fill(i === 4 ? 224 : 32)).flat());
            const input = await sharp(pixels, { raw: { width: 9, height: 1, channels: 3 } }).png().toBuffer();
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["png:-", "-filter", "Mitchell", "-define", define, "+define", define.split("=")[0]!, "-resize", "27x1!", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files, input)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect(Array.from({ length: 5 }, (_, i) => output.data[(9 + i) * 4])).toEqual([26, 43, 98, 168, 203]);
        });
    }
    for (const define of ["filter:b=NaN", "filter:c=Infinity", "filter:sigma=0", "filter:sigma=-1", "filter:window=unknown"]) {
        it(`rejects ${define} without replacing output: ${mode}`, async () => {
            const original = Uint8Array.of(1, 2, 3), files = new Map([["out.png", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out.png", original);
            const args = ["-size", "9x1", "xc:red", "-define", define, "-resize", "27x1!", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).not.toBe(0);
            expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(original);
        });
    }
}
