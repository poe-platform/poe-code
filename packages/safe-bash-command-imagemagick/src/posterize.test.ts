import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// magick -size 1x1 xc:<color> -posterize <levels> -depth 8 rgba:-
for (const retained of [false, true]) {
    it.each([
        [4, "#ff000080", [255, 0, 0, 170]],
        [4, "#80402080", [85, 0, 0, 170]],
        [4, "#80402040", [0, 0, 0, 85]],
        [4, "#80402000", [0, 0, 0, 0]],
        [4, "#aaccffee", [170, 170, 255, 255]],
        [4, "#804020ff", [170, 85, 0, 255]],
        [2, "#80402080", [0, 0, 0, 255]],
        [3, "#80402080", [128, 0, 0, 128]],
        [8, "#80402080", [146, 36, 0, 146]],
        [16, "#80402080", [136, 68, 17, 136]],
        [17, "#80402080", [128, 64, 32, 128]]
    ] as const)(`posterizes with %i levels, %s like ImageMagick, retained=${retained}`, async (levels, color, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file conversion forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await runConvertCli(["-size", "1x1", `xc:${color}`, "-posterize", String(levels), "out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual(expected);
    });
}

// Opaque gray PNG expectations verified with native ImageMagick 7.1.2.
for (const execution of ["command", "buffered", "sync"] as const) {
    it.each([
        [4, 1, [], [85, 85, 85, 170]],
        [1, 4, [], [85, 85, 85, 170]],
        [4, 4, [], [85, 85, 170, 170, 170, 85, 85, 170, 170, 170, 170, 170, 170, 85, 170, 170]],
        [5, 3, [], [85, 170, 170, 170, 170, 85, 85, 170, 85, 85, 170, 170, 170, 170, 170]],
        [4, 1, ["+dither"], [85, 85, 85, 85]],
        [4, 1, ["-dither", "None"], [85, 85, 85, 85]],
        [4, 1, ["+dither", "-dither", "Riemersma"], [85, 85, 85, 170]],
    ] as const)(`${execution}: posterize dithering %ix%i %j`, async (width, height, options, expected) => {
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : 127);
        const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["in.png", ...options, "-posterize", "4", "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = execution === "command" ? await createConvertCommand().execute({
            command: "convert", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}

// Native ImageMagick RGBA hashes cover storage boundaries and clipped Hilbert quadrants.
it.each([
    [1031, 5, "0e9f3735b1e4a3595be95b02561886fb6c69dc98ecf0a4e0523b2de9c384de4d"],
    [1, 4097, "109c0f8680a7d66a53efd9931dfa2bccbd8b1d690910dd89e78111d125a14198"],
] as const)("retains native posterize dithering across %ix%i", async (width, height, expected) => {
    const filesystem = new MemoryFileSystem();
    const result = await runConvertCli(["-size", `${width}x${height}`, "xc:#7f7f7f", "-posterize", "4", "out.png"], { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(await filesystem.readFile("/out.png"));
    expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
});

// Native ImageMagick PNG24 fixture; expectations decoded independently as RGBA8.
for (const execution of ["command", "buffered", "sync"] as const) {
    it.each([
        ["R", [], [0, 0, 0, 255, 255, 0, 0, 255, 128, 0, 0, 255]],
        ["R", ["+dither"], [0, 96, 160, 255, 255, 64, 16, 255, 128, 112, 176, 255]],
        ["G", [], [0, 128, 0, 255, 0, 128, 0, 255, 0, 128, 0, 255]],
        ["G", ["+dither"], [32, 128, 160, 255, 192, 128, 16, 255, 80, 128, 176, 255]],
        ["B", [], [0, 0, 128, 255, 0, 0, 0, 255, 0, 0, 128, 255]],
        ["B", ["+dither"], [32, 96, 128, 255, 192, 64, 0, 255, 80, 112, 128, 255]],
        ["RG", [], [0, 128, 0, 255, 255, 128, 0, 255, 128, 128, 0, 255]],
        ["RG", ["+dither"], [0, 128, 160, 255, 255, 128, 16, 255, 128, 128, 176, 255]],
        ["RGB", [], [0, 128, 128, 255, 255, 128, 0, 255, 128, 128, 128, 255]],
        ["RGB", ["+dither"], [0, 128, 128, 255, 255, 128, 0, 255, 128, 128, 128, 255]],
        ["A", [], [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]],
        ["A", ["+dither"], [32, 96, 160, 255, 192, 64, 16, 255, 80, 112, 176, 255]],
    ] as const)(`${execution}: posterize channel %s %j`, async (channel, options, expected) => {
        const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAAEklEQVQI12NQSFhwwEEgoGADABEKA6ELQwJoAAAAAElFTkSuQmCC", "base64"));
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["in.png", "-channel", channel, ...options, "-posterize", "3", "+channel", "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([...output.data]).toEqual(expected);
    });
}
