import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { operation: "-delete", range: "2-1", pixels: [red, green, blue] },
        { operation: "-delete", range: "-1--2", pixels: [red, green, blue] },
        { operation: "-delete", range: "1-2", pixels: [red] },
        { operation: "-delete", range: "-2--1", pixels: [red] },
        { operation: "-delete", range: "2-1,1", pixels: [red, blue] },
        { operation: "-delete", range: "1-1", pixels: [red, blue] },
        { operation: "-clone", range: "2-0", pixels: [red, green, blue, blue, green, red] }
    ])(`${mode}: $operation $range preserves native image order`, async ({ operation, range, pixels }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", operation, range, "+append", "out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([pixels.length, 1]);
        expect([...output.data]).toEqual(pixels.flat());
    });
}
