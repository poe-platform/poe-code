import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16, 1x1 #804020 input, decoded to 8-bit RGBA.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["-threshold", "128", [255, 255, 255, 255]],
        ["-threshold", "32768", [0, 0, 0, 255]],
        ["-threshold", "65535", [0, 0, 0, 255]],
        ["-threshold", "50%", [0, 0, 0, 255]],
        ["-black-threshold", "128", [128, 64, 32, 255]],
        ["-black-threshold", "32768", [0, 0, 0, 255]],
        ["-black-threshold", "65535", [0, 0, 0, 255]],
        ["-black-threshold", "50%", [0, 0, 0, 255]],
        ["-white-threshold", "128", [255, 255, 255, 255]],
        ["-white-threshold", "32768", [128, 64, 32, 255]],
        ["-white-threshold", "65535", [128, 64, 32, 255]],
        ["-white-threshold", "50%", [128, 64, 32, 255]],
    ] as const)(`matches native %s %s via ${mode}`, async (operator, threshold, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#804020", operator, threshold, "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
