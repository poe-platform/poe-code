import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI storage class, channels, and colorspace.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { type: "Palette", reduction: ["-poly", ".5,1,.5,1"], expected: "DirectClass sRGB |srgb  3.0|sRGB" },
        { type: "PaletteAlpha", reduction: ["-poly", ".5,1,.5,1"], expected: "DirectClass sRGB Alpha|srgba 4.0|sRGB" },
        { type: "Palette", reduction: ["-evaluate-sequence", "Mean"], expected: "DirectClass sRGB |srgb  3.0|sRGB" },
        { type: "TrueColor", reduction: ["-poly", ".5,1,.5,1"], expected: "DirectClass sRGB |srgb  3.0|sRGB" },
    ])(`${mode}: returns direct color after $type $reduction`, async ({ type, reduction, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        const args = ["xc:#2060b080", "xc:#c04020ed", "-type", type, ...reduction,
            "-format", "%r|%[channels]|%[colorspace]", "info:-"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async data => { stdout += new TextDecoder().decode(data); } },
                stderr: { write: async data => { stderr += new TextDecoder().decode(data); } },
            });
            expect(result.exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
        }
        expect(stdout).toBe(expected);
    });
}
