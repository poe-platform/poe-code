import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA16 big-endian output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { matrix: "Blur:2x1+90", expected: "016643e5625671d60b0494e16fe4dad3" },
        { matrix: "Blur:2x1+270", expected: "016643e5625671d60b0494e16fe4dad3" },
        { matrix: "Blur:2x1+0", expected: "3a3b3e3e59597070413168682929cfcf" },
        { matrix: "Blur:2x1+45", expected: "3a3b3e3e59597070413168682929cfcf" },
        { matrix: "Blur:2x1+180", expected: "3a3b3e3e59597070413168682929cfcf" },
        { matrix: "Blur:2x1-90", expected: "016643e5625671d60b0494e16fe4dad3" },
        { matrix: "Blur:2x1+450", expected: "016643e5625671d60b0494e16fe4dad3" },
    ])(`${mode}: applies the rotated $matrix color matrix`, async ({ matrix, expected }) => {
        const argv = ["xc:#173e5970", "xc:#b56829cf", "+append", "-color-matrix", matrix, "-depth", "16", "-endian", "MSB", "rgba:-"];
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
