import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

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
