import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native PNG32: 20x16 xc:#3060a080 with lime bKGD.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABQAAAAQCAYAAAAWGF8bAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAAAP8AAEfbj5IAAAAfSURBVDjLYzRIWNDAQEXARE3DRg0cNXDUwFED6WcgANy4AdAvaT/nAAAAAElFTkSuQmCC", "base64");

it.each(["buffered", "retained", "sync"] as const)("inherits PNG vignette background and honors overrides (%s)", async mode => {
    expect(decodeImage(input).backgroundColor).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    const { backgroundColor: ignoredBackgroundColor, ...withoutBackgroundImage } = decodeImage(input);
    const withoutBackground = encodeImage(withoutBackgroundImage, { format: "png" }).data;
    for (const { bytes, options, edge } of [
        { bytes: input, options: [], edge: [0, 255, 0, 255] },
        { bytes: input, options: ["-background", "white"], edge: [255, 255, 255, 255] },
        { bytes: withoutBackground, options: [], edge: [255, 255, 255, 255] },
    ]) {
        const files = new Map([["/input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["/input.png", ...options, "-vignette", "0x1+3+2", "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([20, 16]);
        expect([...output.data.slice(0, 4)]).toEqual(edge);
        expect([...output.data.slice((8 * 20 + 10) * 4, (8 * 20 + 11) * 4)]).toEqual([48, 96, 160, 255]);
    }
});
