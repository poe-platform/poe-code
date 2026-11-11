import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: unsized tiles retain their source coder;
// -size creates a PATTERN image, which has no encoder of its own.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { argv: ["pattern:horizontal", "-"], hex: "50340a3820340aff000000" },
        { argv: ["pattern:horizontal", "-write", "-", "null:"], hex: "50340a3820340aff000000" },
        { argv: ["-size", "4x3", "pattern:horizontal", "-write", "-", "null:"], error: true },
        { argv: ["pattern:checkerboard", "-"], format: "gif", width: 30, height: 30 },
        { argv: ["-size", "4x3", "pattern:horizontal", "-"], error: true },
        { argv: ["-size", "4x3", "pattern:checkerboard", "-"], error: true },
        { argv: ["pattern:horizontal", "-format", "%m|%f", "info:"], text: "PBM|horizontal" },
        { argv: ["pattern:checkerboard", "-format", "%m|%f", "info:"], text: "GIF|checkerboard" },
        { argv: ["-size", "4x3", "pattern:horizontal", "-format", "%m|%f", "info:"], text: "PATTERN|horizontal" },
        { argv: ["-size", "4x3", "pattern:horizontal", "-depth", "8", "gray:-"], hex: "00000000ffffffffffffffff" },
        { argv: ["-size", "4x3", "pattern:horizontal", "png:-"], format: "png", width: 4, height: 3 },
    ])(`${mode}: preserves pattern source format for $argv`, async ({ argv, hex, format, width, height, text, error }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : new TextEncoder().encode("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(result.exitCode).toBe(error ? 1 : 0);
        if (error) {
            expect("stderr" in result ? result.stderr : stderr).toContain("no encode delegate for this image format 'PATTERN'");
            expect(bytes.length).toBe(0);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (hex !== undefined) expect(Buffer.from(bytes).toString("hex")).toBe(hex);
            if (text !== undefined) expect(new TextDecoder().decode(bytes)).toBe(text);
            if (format !== undefined) expect(decodeImage(bytes)).toMatchObject({ format, width, height });
        }
    });
}
