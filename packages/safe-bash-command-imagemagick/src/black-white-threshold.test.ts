import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "R"], [255, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "R"], [0, 150, 10, 128]],
        ["-white-threshold", [100, 200, 150, 128], ["-channel", "GB"], [100, 255, 255, 128]],
        ["-black-threshold", [200, 30, 150, 128], ["-channel", "GB"], [200, 0, 150, 128]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "RGB"], [255, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "RGB"], [0, 150, 0, 128]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "RGBA"], [255, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "RGBA"], [0, 150, 0, 0]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "A"], [200, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "A"], [100, 150, 10, 0]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "R", "+channel"], [200, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "R", "+channel"], [100, 150, 10, 128]],
    ] as const)(`honors selected channels for %s %j %j via ${mode}`, async (operator, pixel, channels, expected) => {
        const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from(pixel), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...channels, operator, "50%", "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
