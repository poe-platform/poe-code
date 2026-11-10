import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// Native ImageMagick: heading.png -thumbnail '48x32!' +repage, then -crop 14x10+6+5.
const part = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAA4AAAAKBAMAAAB293L0AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAtUExURQ8RFhARFhQVFxgYFxUSFhcYFxcXFxkYFxUVFRgXGBkYGRgYGBYWFhMVFBUWFbHKvxwAAAAQY2FOdgAAADAAAAAgAAAABgAAAAUplEkPAAAAJUlEQVQI12NgVHZxTUtLYyg3Cw0D0WkQgEG34aOngemVq8++BgAWwRz+aZxXzgAAAABJRU5ErkJggg==", "base64");

it.each([false, true])("coalesces a single offset PNG onto its full canvas (retained=%s)", async retained => {
    expect(decodeImage(part)).toMatchObject({
        width: 14, height: 10, virtualCanvas: { width: 48, height: 32, x: 6, y: 5 }
    });
    const files = new Map([["part.png", new Uint8Array(part)]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/part.png", part);
    const context = retained ? { filesystem, cwd: "/" } : files;
    expect(await runMagickCli(["part.png", "-coalesce", "out.png"], context)).toMatchObject({ exitCode: 0 });
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect(output).toMatchObject({ width: 48, height: 32 });
    expect(output.virtualCanvas).toBeUndefined();
    expect(output.data).toHaveLength(6144);
    // SHA-256 of native ImageMagick's out.png -depth 8 rgba:- output.
    expect(createHash("sha256").update(output.data).digest("hex"))
        .toBe("330585c37c10d78cc4da44bb06857b4b18b0e256682e7267e4af95c82a255fd8");

    expect(await runMagickCli(["out.png", "-coalesce", "full.png"], context)).toMatchObject({ exitCode: 0 });
    const full = decodeImage(retained ? await filesystem.readFile("/full.png") : files.get("full.png")!);
    expect(full).toMatchObject({ width: 48, height: 32 });
    expect(full.virtualCanvas).toBeUndefined();
    expect(full.data).toEqual(output.data);
});

for (const retained of [false, true]) {
    it.each([
        { operators: ["-bordercolor", "red", "-border", "2x3"], width: 18, height: 16, canvasWidth: 52, canvasHeight: 38, hash: "19c848ae9752656fe546ef5a5004fd77cc2554b6a4bb77ddf080840a771aedf6" },
        { operators: ["-shave", "2x2"], width: 10, height: 6, canvasWidth: 44, canvasHeight: 28, hash: "d1047b11098b96fcbb8ca2a1cdd13101df9c4861373adde189e3ac2e833ebf64" }
    ])("adjusts the canvas for $operators (retained=" + retained + ")", async ({ operators, width, height, canvasWidth, canvasHeight, hash }) => {
        const files = new Map([["part.png", new Uint8Array(part)]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/part.png", part);
        const context = retained ? { filesystem, cwd: "/" } : files;
        for (const reset of [false, true]) {
            expect(await runMagickCli(["part.png", ...(reset ? ["+repage"] : []), ...operators, "out.png"], context)).toMatchObject({ exitCode: 0 });
            const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect(output).toMatchObject({ width, height });
            // Native ImageMagick RGBA output for the same PNG bytes.
            expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
            expect(output.virtualCanvas ?? { width, height, x: 0, y: 0 }).toEqual(reset
                ? { width, height, x: 0, y: 0 }
                : { width: canvasWidth, height: canvasHeight, x: 6, y: 5 });
        }
    });
}

for (const retained of [false, true]) {
    it.each([
        { operators: ["-extent", "20x18+1+1"], width: 20, height: 18, page: [69, 58, 9, 7], hash: "b10401a3d13492c3c05a00afbd20bab618a107e127015655ff15b0cab4e76b6c" },
        { operators: ["-gravity", "center", "-extent", "20x18"], width: 20, height: 18, page: [69, 58, 9, 7], hash: "9911be8c02b5bcb11e6d6f4f0cd552d891e892f52264530a2b9a36c63050796e" },
        { operators: ["-extent", "7x5"], width: 7, height: 5, page: [24, 16, 3, 2], hash: "3cfa718ef56cb5f9c778529f4e5f7e9537d6e0dc19473cfdb3f38c127fb4fbe7" },
        { operators: ["-extent", "20x18+99+99"], width: 20, height: 18, page: [69, 58, 9, 7], hash: "333e0d6cb69b42d3e10970274437bd7d250ee18cd25df2f5fc9e7bfd024735ca" },
        { operators: ["-extent", "70x5"], width: 70, height: 5, page: [240, 16, 30, 2], hash: "fc257155782865e42adb54cec932778c3d7cdc26fe78bdf779e50c6714c95945" }
    ])("preserves extent page geometry for $operators (retained=" + retained + ")", async ({ operators, width, height, page, hash }) => {
        const files = new Map([["part.png", new Uint8Array(part)]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/part.png", part);
        const context = retained ? { filesystem, cwd: "/" } : files;
        for (const reset of [false, true]) {
            expect(await runMagickCli(["part.png", ...(reset ? ["+repage"] : []), ...operators, "out.png"], context)).toMatchObject({ exitCode: 0 });
            const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect(output).toMatchObject({ width, height });
            // Native ImageMagick RGBA output for the same PNG bytes.
            expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
            expect(output.virtualCanvas ?? { width, height, x: 0, y: 0 }).toEqual(reset
                ? { width, height, x: 0, y: 0 }
                : { width: page[0], height: page[1], x: page[2], y: page[3] });
        }
    });
}
