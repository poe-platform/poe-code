import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native PNG32: transparent 5x4 canvas, red rectangle 1,1 3,2, lime bKGD.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAAAP8AAEfbj5IAAAAcSURBVAjXY2DAAhgZGBgY/jMw/EcSYGRiIBYAAHHPAgRslnQ8AAAAAElFTkSuQmCC", "base64");

it.each(["buffered", "retained", "sync"])("inherits PNG shadow background and honors overrides (%s)", async mode => {
    expect(decodeImage(input).backgroundColor).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    const { backgroundColor: ignoredBackgroundColor, ...withoutBackgroundImage } = decodeImage(input);
    const withoutBackground = encodeImage(withoutBackgroundImage, { format: "png" }).data;
    for (const { bytes, options, color } of [
        { bytes: input, options: [], color: [0, 255, 0] },
        { bytes: input, options: ["-background", "blue"], color: [0, 0, 255] },
        { bytes: withoutBackground, options: [], color: [255, 255, 255] },
    ]) {
        const files = new Map([["/input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["/input.png", ...options, "-shadow", "60x0+0+0", "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(result.stdoutBytes!);
        expect([output.width, output.height]).toEqual([5, 4]);
        expect(output.virtualCanvas).toBeUndefined();
        for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
            const offset = (y * 5 + x) * 4;
            const alpha = x >= 1 && x <= 3 && y >= 1 && y <= 2 ? 153 : 0;
            expect([...output.data.slice(offset, offset + 4)]).toEqual([...color, alpha]);
        }
    }
});
