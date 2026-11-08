import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native: -size 20x16 xc:gray50 -strip -define png:bit-depth=DEPTH PNG00:-
const fixtures = [
    [8, "iVBORw0KGgoAAAANSUhEUgAAABQAAAAQCAAAAAAzcwDHAAAAE0lEQVQY02OsZ8AETAyjgmQKAgC8gQCfCBHlDgAAAABJRU5ErkJggg=="],
    [16, "iVBORw0KGgoAAAANSUhEUgAAABQAAAAQEAAAAABj49yEAAAAGElEQVQoz2Osr2cgCjARp2xU4ahCShQCALURAR51xsC3AAAAAElFTkSuQmCC"],
] as const;

it.each(["buffered", "retained", "sync"] as const)("converts colored vignette backgrounds to the input gray space (%s)", async mode => {
    for (const [depth, fixture] of fixtures) for (const rgb of [false, true]) {
        const gray = Buffer.from(fixture, "base64");
        const input = rgb ? encodeImage({ ...decodeImage(gray), space: "srgb", channels: 3 }, { format: "png" }).data : gray;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-background", "red", "-vignette", "0x1+3+2", "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        // Native Q16-HDRI: gray red = 0x3670; the RGB control stays red.
        const samples = depth === 16 ? output.data16! : output.data;
        const maximum = depth === 16 ? 65535 : 255, corner = depth === 16 ? 0x3670 : 54;
        expect(Array.from(samples.slice(0, 4))).toEqual(rgb ? [maximum, 0, 0, maximum] : [corner, corner, corner, maximum]);
        const center = (8 * 20 + 10) * 4, grayValue = depth === 16 ? 0x7f7f : 127;
        expect(Array.from(samples.slice(center, center + 4))).toEqual([grayValue, grayValue, grayValue, maximum]);
    }
});
