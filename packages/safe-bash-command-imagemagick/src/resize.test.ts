import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runConvertCli, runConvertCliSync, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7, RGB checkerboard PNG, -resize 4x4 (or montage -geometry 4x4+0+0).
const resized = [124, 129, 126, 131, 129, 127, 128, 126, 126, 128, 127, 129, 131, 126, 129, 124]
    .flatMap(value => [value, value, value, 255]);
for (const [operation, geometry, gray] of [
    ["resize", "4x4", undefined],
    ["resize", "3x5!", [124, 128, 131, 129, 128, 126, 128, 128, 128, 126, 128, 129, 131, 128, 124]],
    ["thumbnail", "4x4", [124, 128, 127, 131, 128, 127, 128, 127, 127, 128, 127, 128, 131, 127, 128, 124]],
    ["montage", "4x4", [124, 128, 127, 131, 128, 127, 128, 127, 127, 128, 127, 128, 131, 127, 128, 124]],
] as const) for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`matches native checkerboard resize: ${operation} ${geometry}, ${mode}`, async () => {
        const montage = operation === "montage";
        const pixels = Uint8Array.from({ length: 8 * 8 * 3 }, (_, i) => ((Math.floor(i / 3) % 8 + Math.floor(i / 24)) % 2) * 255);
        const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...(montage ? ["-tile", "1x1", "-geometry", "4x4+0+0"] : ["-" + operation, geometry]), "out.png"];
        const expected = gray ? gray.flatMap(value => [value, value, value, 255]) : resized;
        const result = mode === "sync" ? (montage ? runMontageCliSync : runConvertCliSync)(args, files)
            : await (montage ? runMontageCli : runConvertCli)(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual(geometry === "3x5!" ? [3, 5] : [4, 4]);
        expect([...output.data]).toEqual(expected);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const vertical of [false, true]) {
        it(`matches native point-filter pixel centers: ${mode}, vertical=${vertical}`, async () => {
            const input = await sharp(Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]), {
                raw: { width: vertical ? 1 : 2, height: vertical ? 2 : 1, channels: 4 }
            }).png().toBuffer();
            const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["input.png", "-filter", "point", "-resize", vertical ? "1x3!" : "3x1!", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            // Native ImageMagick 7: red, blue, blue along either axis.
            expect([...output.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
        });
    }
}

// Native ImageMagick samples region midpoints, choosing the preceding pixel at ties.
for (const [source, target, selected] of [
    [2, 1, [0]], [6, 3, [0, 2, 4]], [7, 3, [1, 3, 5]], [3, 7, [0, 0, 1, 1, 1, 2, 2]]
] as const) for (const axis of ["x", "y"] as const) for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`samples native pixels ${source}->${target} along ${axis}, ${mode}`, async () => {
        const pixels = Uint8Array.from(Array.from({ length: source }, (_, i) => [255 - i * 30, i * 20, i * 30, 255 - i * 10]).flat());
        const input = await sharp(pixels, { raw: { width: axis === "x" ? source : 1, height: axis === "y" ? source : 1, channels: 4 } }).png().toBuffer();
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["png:-", "-sample", axis === "x" ? `${target}x1!` : `1x${target}!`, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files, input)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        const decoded = decodeImage(input).data;
        expect([...output.data]).toEqual(selected.flatMap(i => [...decoded.slice(i * 4, i * 4 + 4)]));
    });
}

for (const operation of [["-sample"], ["-filter", "point", "-resize"]]) {
    it(`selects the native red/blue pixel with ${operation.join(" ")}`, async () => {
        const input = await sharp(Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255), { raw: { width: 1, height: 2, channels: 4 } }).png().toBuffer();
        const files = new Map<string, Uint8Array>();
        expect((await runMagickCli(["png:-", ...operation, "1x1!", "out.png"], files, input)).exitCode).toBe(0);
        expect([...decodeImage(files.get("out.png")!).data]).toEqual(operation[0] === "-sample" ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    });
}
