import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./smush-colorspace-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI PNG32 output, decoded to RGBA8.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each(fixtures)(`${mode}: ${operation} preserves $space with $background background and gap $gap`, async ({ space, colors, background, gap, pixels }) => {
            const argv = ["-background", background, "-size", "1x1", ...colors.map(color => `xc:${color}`), "-colorspace", space, operation, gap, "-colorspace", "sRGB", "PNG32:out.png"];
            const args = createCommandArguments(argv), fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual(operation === "+smush" ? [pixels.length / 4, 1] : [1, pixels.length / 4]);
            expect(Array.from(output.data)).toEqual(pixels);
        });
    }
}

it.each(["HSL", "HSB", "XYZ", "HWB"])("preserves PNG source colors through a %s smush round trip", async space => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAEklEQVR4nGO4wyX3HxkzEBQAAGT5GCWP9zVLAAAAAElFTkSuQmCC", "base64"));
    await fs.writeFile("/b.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGPg0rj0H4YZkDkAkmkMEySm8r8AAAAASUVORK5CYII=", "base64"));
    const args = createCommandArguments(["a.png", "b.png", "-colorspace", space, "+smush", "0", "-colorspace", "sRGB", "PNG32:out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([7, 3]);
    expect(Array.from(output.data.subarray(0, 4))).toEqual([220, 10, 30, 255]);
    expect(Array.from(output.data.subarray(16, 20))).toEqual([10, 40, 210, 255]);
});

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output including the background.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { firstCmyk: true, secondCmyk: false, rgba: "ba95dfffba95dfffffffffffba95dfffba95dfffffffffffbf8dd5ffbf8dd5fff3dbebfff3dbebfff3dbebfff3dbebff" },
        { firstCmyk: false, secondCmyk: true, rgba: "bf9fdfffbf9fdfffffffffffbf9fdfffbf9fdfffffffffffba77c4ffba77c4ffeabfdbffeabfdbffeabfdbffeabfdbff" },
        { firstCmyk: true, secondCmyk: true, rgba: "ba95dfffba95dfffffffffffba95dfffba95dfffffffffff9098b5ff9098b5ffbde3caffbde3caffbde3caffbde3caff" },
        { firstCmyk: false, secondCmyk: false, rgba: "bf9fdfffbf9fdfffffffffffbf9fdfffbf9fdfffffffffff9b9bbbff9b9bbbffcbe3d3ffcbe3d3ffcbe3d3ffcbe3d3ff" }
    ])(`${mode}: smush composites channel samples with first CMYK=$firstCmyk and second CMYK=$secondCmyk`, async ({ firstCmyk, secondCmyk, rgba }) => {
        const argv = [
            "(", "-size", "2x3", "xc:#8040c080", ...(firstCmyk ? ["-colorspace", "CMYK"] : []), ")",
            "(", "-size", "3x2", "xc:#30905040", ...(secondCmyk ? ["-colorspace", "CMYK"] : []), ")",
            "-smush", "-1", "-colorspace", "sRGB", "-depth", "8", "rgba:out"
        ];
        const fs = new MemoryFileSystem(), files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        await fs.writeFile("/out", files.get("out")!);
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(rgba);
    });
}
