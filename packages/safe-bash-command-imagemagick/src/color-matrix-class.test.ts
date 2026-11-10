import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI class names and raw RGBA8 bytes.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "indexed control", colors: ["#804020", "#308080"], options: ["-colors", "2"], output: ["-format", "%r", "info:-"], expected: "PseudoClass sRGB " },
        { name: "indexed identity class", colors: ["#804020", "#308080"], options: ["-colors", "2", "-color-matrix", "1"], output: ["-format", "%r", "info:-"], expected: "DirectClass sRGB " },
        { name: "indexed channel permutation class", colors: ["#804020", "#308080"], options: ["-colors", "2", "-color-matrix", "0 1 0 0 0 1 1 0 0"], output: ["-format", "%r", "info:-"], expected: "DirectClass sRGB " },
        { name: "indexed identity pixels", colors: ["#804020", "#308080"], options: ["-colors", "2", "-color-matrix", "1"], output: ["-depth", "8", "rgba:-"], expected: Buffer.from("804020ff308080ff", "hex") },
        { name: "identity alpha pixels", colors: ["#80502060", "#308080c0"], options: ["-color-matrix", "1"], output: ["-depth", "8", "rgba:-"], expected: Buffer.from("80502060308080c0", "hex") },
    ])(`${mode}: color matrix preserves $name`, async ({ colors, options, output, expected }) => {
        const argv = [...colors.map(color => `xc:${color}`), "+append", ...options, ...output];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const actual = Buffer.from(result.stdoutBytes ?? result.stdout);
        expect(actual).toEqual(Buffer.from(expected));
    });
}
