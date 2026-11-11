import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: shadows drop the palette index channel.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { palette: true, sigma: 0, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { palette: true, sigma: 1, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { palette: false, sigma: 0, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { palette: false, sigma: 1, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { palette: true, sigma: undefined, expected: "PseudoClass sRGB Alpha|srgba 5.0" },
    ])(`${mode}: reports native shadow class and channels (palette=$palette, sigma=$sigma)`, async ({ palette, sigma, expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["xc:#50609080", ...(palette ? ["-type", "PaletteAlpha"] : []),
            "-background", "#d04020", ...(sigma === undefined ? [] : ["-shadow", `80x${sigma}+0+0`]),
            "-format", "%r|%[channels]", "info:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
