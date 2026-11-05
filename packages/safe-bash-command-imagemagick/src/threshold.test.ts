import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick Q16 output for the two RGBA pixels below.
    it.each([
        ["R", [255, 30, 100, 200, 0, 150, 10, 100]],
        ["G", [200, 0, 100, 200, 100, 255, 10, 100]],
        ["B", [200, 30, 0, 200, 100, 150, 0, 100]],
        ["A", [200, 30, 100, 255, 100, 150, 10, 0]],
        ["RGB", [255, 0, 0, 200, 0, 255, 0, 100]],
        ["RGBA", [255, 0, 0, 255, 0, 255, 0, 0]],
    ] as const)(`thresholds only selected %s channels via ${mode}`, async (channel, expected) => {
        const input = encodeImage({ width: 2, height: 1, data: new Uint8Array([200, 30, 100, 200, 100, 150, 10, 100]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-channel", channel, "-threshold", "50%", "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
    // Native ImageMagick Q16, 1x1 #804020 input, decoded to 8-bit RGBA.
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
