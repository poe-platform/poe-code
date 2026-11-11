import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves linear RGB samples when disabling alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "Palette alpha off", options: ["-type", "Palette", "-alpha", "off"], expected: "b03050ff" },
    { name: "PaletteAlpha alpha off", options: ["-type", "PaletteAlpha", "-alpha", "off"], expected: "b03050ff" },
    { name: "PaletteAlpha retains alpha", options: ["-type", "PaletteAlpha"], expected: "b0305070" },
    { name: "direct alpha off", options: ["-alpha", "off"], expected: "b03050ff" },
])(`${mode}: $name`, async ({ options, expected }) => {
    const argv = ["xc:#b0305070", "-colorspace", "RGB", ...options, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
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
