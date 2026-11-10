import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const first = ["(", "-size", "2x1", "xc:#2060b080"];
const second = ["(", "-size", "1x2", "xc:#c04020ed", ")"];

// Native ImageMagick 7.1.2-35 Q16-HDRI retains the first input's grayscale type.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["-append", "+append"])
it.each([
    { name: "scoped grayscale", args: [...first, "-type", "Grayscale", ")", ...second], type: "Grayscale" },
    { name: "global grayscale", args: [...first, ")", ...second, "-type", "Grayscale"], type: "Grayscale" },
    { name: "single grayscale", args: [...first, "-type", "Grayscale", ")"], type: "Grayscale" },
    { name: "grayscale on second input", args: [...first, ")", ...second.slice(0, -1), "-type", "Grayscale", ")"], type: "PaletteAlpha" },
    { name: "scoped grayscale alpha", args: [...first, "-type", "GrayscaleAlpha", ")", ...second], type: "GrayscaleAlpha" },
    { name: "reset scoped grayscale", args: [...first, "-type", "Grayscale", "-type", "TrueColorAlpha", ")", ...second], type: "PaletteAlpha" },
    { name: "no explicit type", args: [...first, ")", ...second], type: "PaletteAlpha" },
])(`${mode} ${direction}: $name`, async ({ args, type }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const previous = new TextEncoder().encode("KEEP");
    await fs.writeFile("/out", previous);
    files.set("/out", previous);
    const argv = [...args, direction, "-format", "%[type]", "info:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(new TextDecoder().decode(bytes)).toBe(type);
});
