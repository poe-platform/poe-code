import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick retains Palette's inactive alpha when Off is applied again.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "Palette Off then Activate", type: "Palette", operations: ["-alpha", "off", "-alpha", "activate"], expected: "b0305070" },
    { name: "Palette Off then splice", type: "Palette", operations: ["-alpha", "off", "-background", "#8040a080", "-splice", "1x0+1+0"], expected: "b03050708040a080" },
    { name: "Palette Activate", type: "Palette", operations: ["-alpha", "activate"], expected: "b0305070" },
    { name: "PaletteAlpha Off then Activate", type: "PaletteAlpha", operations: ["-alpha", "off", "-alpha", "activate"], expected: "b0305000" },
])(`${mode}: $name`, async ({ type, operations, expected }) => {
    const argv = ["xc:#b0305070", "-colorspace", "sRGB", "-type", type, ...operations, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
    expect(output.toString("hex")).toBe(expected);
});
