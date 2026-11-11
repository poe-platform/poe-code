import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including opaque and 8-bit controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) for (const preframe of [false, true]) {
    it.each([
        { depth: "16", opaque: false, corner: "28288080b0b07070", source: "ce4c7ca997e0ffff" },
        { depth: "16", opaque: true, corner: "28288080b0b07070", source: "c0c030306060ffff" },
        { depth: "8", opaque: false, corner: "2880b070", source: "cd7c97ff" },
    ])(`${mode}: preserves frame blend precision at depth $depth, opaque=$opaque, preframe=${preframe}`, async ({ depth, opaque, corner, source }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "3x2", "xc:#c0306090", "-mattecolor", "#2880b070",
            ...(opaque ? ["-alpha", "opaque"] : []), "-compose", "Over",
            ...(preframe ? ["-frame", "0x0"] : []), "-frame", "3x3+0+0",
            "-depth", depth, "-endian", "MSB", "rgba:-"];
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        const expected = Array.from({ length: 9 * 8 }, (_, pixel) => {
            const x = pixel % 9, y = Math.floor(pixel / 9);
            return x >= 3 && x < 6 && y >= 3 && y < 5 ? source : corner;
        }).join("");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
