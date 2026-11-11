import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { matrix: "Sobel", expected: "00000080" },
        { matrix: "Sobel:0", expected: "00000080" },
        { matrix: "Sobel:22.5", expected: "00000080" },
        { matrix: "Sobel:22.5001", expected: "40000080" },
        { matrix: "Sobel:45", expected: "40000080" },
        { matrix: "Sobel:67.5", expected: "40000080" },
        { matrix: "Sobel:67.5001", expected: "80000080" },
        { matrix: "Sobel:90", expected: "80000080" },
        { matrix: "Sobel:135", expected: "80200080" },
        { matrix: "Sobel:180", expected: "20402080" },
        { matrix: "Sobel:225", expected: "00208080" },
        { matrix: "Sobel:270", expected: "00008080" },
        { matrix: "Sobel:315", expected: "00004080" },
        { matrix: "Sobel:337.5", expected: "00004080" },
        { matrix: "Sobel:337.5001", expected: "00000080" },
        { matrix: "Sobel:-45", expected: "00004080" },
        { matrix: "Sobel:-90", expected: "00008080" },
        { matrix: "Sobel:405", expected: "40000080" },
        { matrix: "1 2 1 0 0 0 -1 -2 -1", expected: "80000080" },
    ])(`${mode}: applies the rotated $matrix color matrix`, async ({ matrix, expected }) => {
        const argv = ["xc:#10203080", "-color-matrix", matrix, "-depth", "8", "rgba:-"];
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
