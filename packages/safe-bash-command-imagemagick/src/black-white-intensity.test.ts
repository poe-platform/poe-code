import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Pixels above 50%, recorded with ImageMagick 7.1.2-35 Q16-HDRI.
// The first pixel reproduces the Brightness difference; the second distinguishes Average.
const pixels = [37, 120, 203, 30, 220, 20, 180, 160, 240, 100, 10, 200, 128, 128, 128, 255];
const cases = [
    { args: [], above: [false, false, false, true] },
    { args: ["-intensity", "Rec709Luma"], above: [false, false, false, true] },
    { args: ["-intensity", "Average"], above: [false, true, false, true] },
    { args: ["-intensity", "Mean"], above: [false, true, false, true] },
    { args: ["-intensity", "Brightness"], above: [true, true, true, true] },
    { args: ["-intensity", "Lightness"], above: [false, false, false, true] },
    { args: ["-intensity", "MS"], above: [false, false, false, false] },
    { args: ["-intensity", "RMS"], above: [true, true, true, true] },
    { args: ["-intensity", "Rec601Luma"], above: [false, false, true, true] },
    { args: ["-intensity", "Rec601Luminance"], above: [false, false, false, false] },
    { args: ["-intensity", "Rec709Luminance"], above: [false, false, false, false] },
    { args: ["-intensity", "Brightness", "+intensity"], above: [false, false, false, true] },
    { args: ["-intensity", "Brightness", "-intensity", "Undefined"], above: [false, false, false, true] },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const depth of [8, 16] as const) {
        for (const operator of ["-black-threshold", "-white-threshold"] as const) {
            it.each(cases)(`${mode}: ${depth}-bit ${operator} honors $args`, async ({ args, above }) => {
                // Non-byte-aligned Q16 samples also check that unaffected channels retain precision.
                const samples = pixels.map(value => depth === 16 ? Math.min(65535, value * 257 + 37) : value);
                const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from(pixels),
                    ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}),
                    format: "png", space: "srgb", channels: 4, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true
                }, { format: "png" }).data;
                const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["in.png", ...args, operator, "50%", `PNG${depth * 4}:out.png`];
                const arguments_ = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
                const black = operator === "-black-threshold";
                const expected = samples.map((value, index) => index % 4 === 3
                    ? black ? 0 : value
                    : above[Math.floor(index / 4)] !== black ? black ? 0 : depth === 16 ? 65535 : 255 : value);
                expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(expected);
            });
        }
    }

    it.each(["-black-threshold", "-white-threshold"])(`${mode}: explicit RGB channels ignore intensity for %s`, async operator => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#2578cb1e", "-intensity", "Brightness", "-channel", "RGB", operator, "50%", "PNG32:out.png"];
        const arguments_ = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([...output.data]).toEqual(operator === "-black-threshold" ? [0, 0, 203, 30] : [37, 120, 255, 30]);
    });
}
