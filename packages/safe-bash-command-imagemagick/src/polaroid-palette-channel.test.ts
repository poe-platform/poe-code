import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: polaroid drops the palette index channel.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { type: "Palette", polaroid: true, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { type: "PaletteAlpha", polaroid: true, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { type: undefined, polaroid: true, expected: "DirectClass sRGB Alpha|srgba 4.0" },
        { type: "Palette", polaroid: false, expected: "PseudoClass sRGB |srgb  4.0" },
    ])(`${mode}: reports native storage class and channels (type=$type, polaroid=$polaroid)`, async ({ type, polaroid, expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["-seed", "7", "-size", "8x6", "xc:red", ...(type ? ["-type", type] : []),
            ...(polaroid ? ["-polaroid", "0"] : []), "-format", "%r|%[channels]", "info:/out"];
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
