import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references for the inline color and 16-bit RGBA output.
for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each([
        ["^15x25", "3b66abd6ffffb3de"],
        ["!15x25", "3b66abd6ffffb3de"],
        ["15x^25", "3b66abd6ffffb3de"],
        ["15x25^", "3b66abd6ffffb3de"],
        ["15x25", "3b66abd6ffffb3de"],
        ["0x25", "083378a3f92380ab"],
        ["15", "4c8ca0e0ffffa6e6"],
    ])(`${mode}: preserves brightness and contrast in %s`, async (geometry, expected) => {
        const argv = ["xc:#267ada80", "-brightness-contrast", geometry, "-depth", "16", "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "magick" || mode === "convert" ? {
            ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr
        } : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(expected);
    });
}
