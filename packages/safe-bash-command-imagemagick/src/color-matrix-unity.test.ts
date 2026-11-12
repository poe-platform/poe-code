import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw big-endian RGBA16 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { kernel: "Unity:50%", expected: "ffff3e3e59597070ffff68682929cfcf" },
        { kernel: "Unity:50", expected: "ffff3e3e59597070ffff68682929cfcf" },
        { kernel: "Unity:bad", expected: "17173e3e59597070b5b568682929cfcf" },
        { kernel: "Unity", expected: "17173e3e59597070b5b568682929cfcf" },
        { kernel: "Unity:0.5", expected: "0b8c3e3e595970705adb68682929cfcf" },
        { kernel: "Unity:0", expected: "00003e3e59597070000068682929cfcf" },
    ])(`${mode}: resolves the $kernel coefficient`, async ({ kernel, expected }) => {
        const argv = ["xc:#173e5970", "xc:#b56829cf", "+append", "-color-matrix", kernel,
            "-depth", "16", "-endian", "MSB", "rgba:-"];
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
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(expected);
        expect(result.stderr).toBe("");
    });
}
