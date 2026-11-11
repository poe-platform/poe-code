import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains HALD as a decode-only source format.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { argv: ["hald:2", "-"], error: true },
        { argv: ["hald:2", "-write", "-", "null:"], error: true },
        { argv: ["hald:2", "-format", "%m|%f|%wx%h", "info:"], text: "HALD|2|8x8" },
        { argv: ["HALD:3", "-format", "%m|%f|%wx%h", "info:"], text: "HALD|3|27x27" },
        { argv: ["hald:2", "-crop", "4x1+0+0", "+repage", "-depth", "8", "-endian", "MSB", "rgb:-"], hex: "000000550000aa0000ff0000" },
        { argv: ["hald:2", "png:-"], png: true },
        { argv: ["hald:2", "/lut.png"], file: "/lut.png", png: true },
    ])(`${mode}: retains HALD source metadata for $argv`, async ({ argv, error, text, hex, png, file }) => {
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
            expect("stderr" in result ? result.stderr : stderr).toContain("no encode delegate for this image format 'HALD'");
            expect(bytes.length).toBe(0);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (text !== undefined) expect(new TextDecoder().decode(bytes)).toBe(text);
            if (hex !== undefined) expect(Buffer.from(bytes).toString("hex")).toBe(hex);
            if (png) {
                const encoded = file ? mode === "command" || mode === "retained" ? await fs.readFile(file) : files.get(file)! : bytes;
                expect(decodeImage(encoded)).toMatchObject({ format: "png", width: 8, height: 8 });
            }
        }
    });
}
