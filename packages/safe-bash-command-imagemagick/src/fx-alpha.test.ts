import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

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
            const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([64, 128, 192, alpha]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
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

// Native PNG24/PNG32 encodings of identical opaque RGBA pixels.
const fixtures = [
    { hasAlpha: false, png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12N0aDjw4MIFAAweBAL98aI6AAAAAElFTkSuQmCC" },
    { hasAlpha: true, png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12N0aDjw/8GFCwwAFp0FATtDSdoAAAAASUVORK5CYII=" },
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const { hasAlpha, png } of fixtures) {
        for (const channels of [[], ["-channel", "RGBA"], ["-channel", "RGB"]]) {
            it.each([["0.5", 128], ["p{1,0}.g", 80]] as const)(`${mode}: FX %s respects input alpha=${hasAlpha} with ${channels}`, async (expression, value) => {
                const input = Buffer.from(png, "base64");
                expect(decodeImage(input).hasAlpha).toBe(hasAlpha);
                const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                const args = ["input.png", ...channels, "-fx", expression, "out.png"];
                const argumentValues = createCommandArguments(args);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
                    signal: new AbortController().signal, registerCleanup() {},
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
                const alpha = hasAlpha && !channels.includes("RGB") ? value : 255;
                expect(Array.from(decodeImage(output).data)).toEqual([value, value, value, alpha, value, value, value, alpha]);
            });
        }
    }
}
