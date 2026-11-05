import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Pixel expectations verified against native ImageMagick.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["#ff000000", "blue", [0, 0, 255, 0]],
        ["#ff000000", "#00ff0080", [0, 255, 0, 0]],
        ["#ff000080", "blue", [255, 0, 0, 128]],
        ["red", "blue", [255, 0, 0, 255]],
    ] as const)(`${mode}: alpha background on %s with %s`, async (color, background, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", `xc:${color}`, "-background", background, "-alpha", "background", "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
