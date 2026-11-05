import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const alpha of [80, 255]) {
        it.each([
            { expression: "r", channels: [], expected: [64, 64, 64, 64] },
            { expression: "0.5", channels: [], expected: [128, 128, 128, 128] },
            { expression: "r", channels: ["-channel", "RGB"], expected: [64, 64, 64, alpha] },
            { expression: "r", channels: ["-channel", "RGBA"], expected: [64, 64, 64, 64] },
            { expression: "r", channels: ["-channel", "A"], expected: [64, 128, 192, 64] },
            { expression: "r", channels: ["-channel", "RGB", "+channel"], expected: [64, 64, 64, 64] }
        ])(`applies FX $expression with $channels to alpha ${alpha} via ${mode}`, async ({ expression, channels, expected }) => {
            const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([64, 128, 192, alpha]), format: "png", space: "srgb", channels: alpha === 255 ? 3 : 4, depth: "uchar", density: 72, hasAlpha: alpha !== 255 }, { format: "png" }).data;
            const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["input.png", ...channels, "-fx", expression, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect(Array.from(decodeImage(output).data)).toEqual(expected);
        });
    }
}
