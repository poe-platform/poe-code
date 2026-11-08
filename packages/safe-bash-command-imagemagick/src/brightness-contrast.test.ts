import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-31: magick -size 1x1 xc:COLOR [-channel CHANNEL]
// -brightness-contrast GEOMETRY -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["#80402080", "0x20", [], [128, 48, 8, 128]],
        ["#80402080", "10x0", [], [154, 90, 58, 154]],
        ["#80402080", "10x20", [], [160, 80, 40, 160]],
        ["#80402080", "-10x-20", [], [108, 56, 31, 108]],
        ["#80402080", "0x-100", [], [128, 128, 128, 128]],
        ["#80402080", "0x100", [], [255, 0, 0, 255]],
        ["#80402080", "-10x-20", ["-alpha", "off"], [108, 56, 31, 255]],
        ["#80402080", "10x20", ["-channel", "R"], [160, 64, 32, 128]],
        ["#80402080", "10x20", ["-channel", "RGB"], [160, 80, 40, 128]],
        ["#80402080", "10x20", ["-channel", "A"], [128, 64, 32, 160]],
    ] as const)(`matches native brightness-contrast for %s %s %j via ${mode}`, async (color, geometry, channel, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", `xc:${color}`, ...channel, "-brightness-contrast", geometry, "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
