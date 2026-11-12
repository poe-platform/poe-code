import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps inactive CMYK alpha channels,
// but includes the type's Alpha suffix only when alpha is active.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { space: "CMYK", alpha: "Discrete", expected: "ColorSeparation|cmyka 5.0" },
        { space: "CMYK", alpha: "Deactivate", expected: "ColorSeparation|cmyka 5.0" },
        { space: "CMYK", alpha: "On", expected: "ColorSeparationAlpha|cmyka 5.0" },
        { space: "CMYK", alpha: "Off", expected: "ColorSeparation|cmyk  4.0" },
        { space: "sRGB", alpha: "Discrete", expected: "PaletteAlpha|srgba 4.0" },
        { space: "sRGB", alpha: "Deactivate", expected: "PaletteAlpha|srgba 4.0" },
        { space: "sRGB", alpha: "On", expected: "PaletteAlpha|srgba 4.0" },
        { space: "sRGB", alpha: "Off", expected: "Palette|srgb  3.0" }
    ])(`${mode}: reports $space type and channels with $alpha alpha`, async ({ space, alpha, expected }) => {
        const argv = ["xc:#123456", "-colorspace", space, "-alpha", alpha, "-format", "%[type]|%[channels]", "info:"];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
