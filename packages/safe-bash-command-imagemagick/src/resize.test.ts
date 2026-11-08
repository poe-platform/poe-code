import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createConvertCommand, createMontageCommand, runMagickCli, runConvertCli, runConvertCliSync, runMontageCli, runMontageCliSync } from "./index.js";

// Decoded RGBA from ImageMagick 7.1.2 Q16-HDRI: sticker.png -thumbnail SIZE png:-.
// These exercise sampling + box filtering, box filtering alone, and final filtering alone.
for (const [size, digest] of [
    [80, "4752eee3485ad62cf3d5f3c86af83419128a8cb2611e91748a15d1578511ae09"],
    [160, "1990427d3ea28d60b8a20761a13f2051be9dfaa9c3c35b623a90108a9569021c"],
    [256, "2bc13bc6b5a3a6f4ee82f2e8ac3472cd3cbf8c6a89af849b60fdc469cb8dc0ae"]
] as const) for (const mode of ["buffered", "retained", "sync", "convert", "montage"] as const) {
    it(`matches native sticker thumbnail ${size}: ${mode}`, async () => {
        const input = readFileSync(new URL("./fixtures/sticker.png", import.meta.url));
        const filesystem = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(mode === "montage" ? ["-tile", "1x1", "-geometry", `${size}x${size}+0+0`] : ["-thumbnail", `${size}x${size}`]), "/out.png"];
        let result;
        if (mode === "convert" || mode === "montage") {
            const argumentValues = createCommandArguments(args);
            const context = {
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {},
                signal: new AbortController().signal, fs: filesystem,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
            } as unknown as CommandContext;
            result = await (mode === "convert" ? createConvertCommand() : createMontageCommand()).execute(context);
        } else {
            result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        }
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([size, size]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(digest);
    });
}

// ImageMagick 7, RGB checkerboard PNG, -resize 4x4 (or montage -geometry 4x4+0+0).
const resized = [124, 129, 126, 131, 129, 127, 128, 126, 126, 128, 127, 129, 131, 126, 129, 124]
    .flatMap(value => [value, value, value, 255]);

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`preserves native thumbnail filtering separately from resize: ${mode}`, async () => {
        const input = await sharp(Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255), {
            raw: { width: 3, height: 1, channels: 4 }
        }).png().toBuffer();
        // Native ImageMagick 7.1.2 Q16-HDRI, using the same RGBA PNG bytes.
        for (const [operation, expected] of [
            ["-thumbnail", [169, 106, 0, 255, 0, 106, 169, 255]],
            ["-resize", [156, 100, 0, 255, 0, 100, 156, 255]]
        ] as const) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["png:-", operation, "2x1!", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files, input)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual([2, 1]);
            expect([...output.data]).toEqual(expected);
        }
    });
}

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

// Native ImageMagick 7 area averages, independent of the configured resize filter.
for (const [pixels, target, expected] of [
    [[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 2, [170, 85, 0, 255, 0, 85, 170, 255]],
    [[255, 0, 0, 255, 0, 0, 255, 255], 3, [255, 0, 0, 255, 128, 0, 128, 255, 0, 0, 255, 255]],
    [[255, 0, 0, 255, 0, 0, 255, 0], 1, [255, 0, 0, 128]]
] as const) for (const vertical of [false, true]) for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`area averages scale to ${target}, vertical=${vertical}, ${mode}`, async () => {
        const source = pixels.length / 4;
        const input = await sharp(Uint8Array.from(pixels), { raw: {
            width: vertical ? 1 : source, height: vertical ? source : 1, channels: 4
        } }).png().toBuffer();
        for (const filter of [[], ["-filter", "point"]]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["png:-", ...filter, "-scale", vertical ? `1x${target}!` : `${target}x1!`, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files, input)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual(vertical ? [1, target] : [target, 1]);
            expect([...output.data]).toEqual(expected);
        }
    });
}

// ImageMagick 7 selects Mitchell for alpha images and enlargement; RGB reduction uses Lanczos.
for (const [channels, target, filter, expected] of [
    [4, 2, [], [156, 100, 0, 255, 0, 100, 156, 255]],
    [3, 2, [], [167, 107, 0, 255, 0, 107, 167, 255]],
    [4, 2, ["-filter", "Lanczos"], [167, 107, 0, 255, 0, 107, 167, 255]],
    [3, 2, ["-filter", "Mitchell"], [156, 100, 0, 255, 0, 100, 156, 255]],
    [3, 6, [], [255, 0, 0, 255, 195, 64, 0, 255, 64, 197, 0, 255, 0, 197, 64, 255, 0, 64, 195, 255, 0, 0, 255, 255]],
    [4, 6, [], [255, 0, 0, 255, 195, 64, 0, 255, 64, 197, 0, 255, 0, 197, 64, 255, 0, 64, 195, 255, 0, 0, 255, 255]]
] as const) for (const vertical of [false, true]) for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`selects native resize filter: channels=${channels}, target=${target}, filter=${filter}, vertical=${vertical}, ${mode}`, async () => {
        const pixels = [ [255, 0, 0], [0, 255, 0], [0, 0, 255] ].flatMap(rgb => channels === 4 ? [...rgb, 255] : rgb);
        const input = await sharp(Uint8Array.from(pixels), { raw: {
            width: vertical ? 1 : 3, height: vertical ? 3 : 1, channels
        } }).png().toBuffer();
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["png:-", ...filter, "-resize", vertical ? `1x${target}!` : `${target}x1!`, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files, input)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([...output.data]).toEqual(expected);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`matches native Mitchell enlargement across both axes: ${mode}`, async () => {
        const input = await sharp(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]), {
            raw: { width: 3, height: 2, channels: 3 }
        }).png().toBuffer();
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["png:-", "-resize", "6x4!", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files, input)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        // Native ImageMagick 7 Q16-HDRI, RGB six-color input.
        expect([...output.data]).toEqual([255, 0, 0, 255, 195, 58, 0, 255, 65, 195, 0, 255, 0, 197, 58, 255, 0, 64, 193, 255, 0, 0, 255, 255, 255, 57, 0, 255, 194, 112, 12, 255, 63, 212, 43, 255, 10, 195, 113, 255, 44, 63, 211, 255, 65, 0, 255, 255, 255, 190, 0, 255, 192, 211, 44, 255, 60, 245, 142, 255, 43, 192, 212, 255, 143, 61, 243, 255, 198, 0, 255, 255, 255, 255, 0, 255, 191, 255, 62, 255, 58, 255, 197, 255, 60, 190, 255, 255, 197, 60, 255, 255, 255, 0, 255, 255]);
    });
}
