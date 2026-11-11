import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, seed 7, 8x6 red canvas.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colorspace: "Gray", polaroid: false, expected: "Gray|gray  1.0|0.454545" },
        { colorspace: "LinearGray", polaroid: false, expected: "LinearGray|lineargray  1.0|1" },
        { colorspace: "sRGB", polaroid: false, expected: "sRGB|srgb  3.0|0.454545" },
        { colorspace: "Gray", polaroid: true, expected: "sRGB|srgba 4.0|0.454545" },
        { colorspace: "LinearGray", polaroid: true, expected: "sRGB|srgba 4.0|0.454545" },
        { colorspace: "sRGB", polaroid: true, expected: "sRGB|srgba 4.0|0.454545" },
        { colorspace: "CMYK", polaroid: true, expected: "CMYK|cmyka 5.0|0.454545" },
        { colorspace: "RGB", polaroid: true, expected: "RGB|rgba 4.0|1" },
        ...["Gray", "LinearGray"].map(colorspace => ({
            colorspace, polaroid: true, pixels: true,
            expected: "6abb6b2c2cb358507c1e7025f18f86892005947ef6bea321b024131bb74fd946",
        })),
    ])(`${mode}: $colorspace polaroid=$polaroid pixels=$pixels matches native`, async ({ colorspace, polaroid, expected, ...test }) => {
        const pixels = "pixels" in test && test.pixels;
        const argv = ["-seed", "7", "-size", "8x6", "xc:red", "-colorspace", colorspace,
            ...(polaroid ? ["-polaroid", "0"] : []),
            ...(pixels ? ["-depth", "8", "rgba:out"] : ["-format", "%[colorspace]|%[channels]|%[gamma]", "info:out"])];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        if (pixels) expect(output.byteLength).toBe(4896);
        expect(pixels ? createHash("sha256").update(output).digest("hex") : new TextDecoder().decode(output)).toBe(expected);
    });
}
