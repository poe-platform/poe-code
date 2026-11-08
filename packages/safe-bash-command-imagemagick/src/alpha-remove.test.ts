import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// Native ImageMagick Q16-HDRI output, compared as decoded RGBA8.
it.each([
    ["white", [166, 172, 189, 255, 227, 231, 236, 255]],
    ["black", [39, 45, 62, 255, 36, 40, 45, 255]],
    ["#123456", [48, 71, 105, 255, 50, 79, 110, 255]]
] as const)("rounds alpha removal over %s like native in both backends", async (background, blended) => {
    const data = Uint8Array.from([12, 34, 56, 255, 78, 90, 123, 128, 144, 160, 180, 64, 210, 220, 230, 255]);
    const input = encodeImage({ width: 2, height: 2, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    for (const retained of [false, true]) {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runMagickCli(["/in.png", "-background", background, "-alpha", "remove", "-alpha", "off", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([2, 2]);
        expect(Array.from(image.data)).toEqual([12, 34, 56, 255, ...blended, 210, 220, 230, 255]);
    }
});
