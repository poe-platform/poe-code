import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Storage classes from ImageMagick 7.1.2-35 Q16-HDRI, including the trailing spaces.
for (const mode of ["sync", "map", "filesystem", "command"] as const)
it.each([
    {
        name: "palette pair",
        inputs: ["xc:red", "xc:blue", "-type", "Palette"], count: "1",
        expected: "PseudoClass sRGB |DirectClass sRGB |PseudoClass sRGB |"
    },
    {
        name: "two inserted frames",
        inputs: ["(", "-size", "1x1", "xc:#123456", "-type", "Palette", ")", "(", "-size", "1x1", "xc:#432189", "-type", "Palette", ")"], count: "2",
        expected: "PseudoClass sRGB |DirectClass sRGB |DirectClass sRGB |PseudoClass sRGB |"
    },
    {
        name: "palette alpha",
        inputs: ["(", "-size", "1x1", "xc:#123456", "-type", "PaletteAlpha", ")", "(", "-size", "1x1", "xc:#432189", "-type", "PaletteAlpha", ")"], count: "1",
        expected: "PseudoClass sRGB Alpha|DirectClass sRGB Alpha|PseudoClass sRGB Alpha|"
    },
    {
        name: "no inserted frames",
        inputs: ["xc:#123456", "xc:#432189", "-type", "Palette"], count: "0",
        expected: "PseudoClass sRGB |PseudoClass sRGB |"
    },
    {
        name: "true color pair",
        inputs: ["xc:#123456", "xc:#432189", "-type", "TrueColor"], count: "1",
        expected: "DirectClass sRGB |DirectClass sRGB |DirectClass sRGB |"
    },
    {
        name: "single palette source",
        inputs: ["xc:#123456", "-type", "Palette"], count: "2",
        expected: "PseudoClass sRGB |PseudoClass sRGB |"
    }
])(`reports morph storage classes for $name (${mode})`, async ({ inputs, count, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = [...inputs, "-morph", count, "-format", "%r|", "info:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    expect(new TextDecoder().decode(mode === "filesystem" || mode === "command" ? await fs.readFile("/out") : files.get("/out"))).toBe(expected);
});
