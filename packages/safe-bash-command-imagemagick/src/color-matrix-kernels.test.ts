import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { kernel: "Gaussian:1x1", expected: "090e0980" },
        { kernel: "Gaussian", expected: "00200080" },
        { kernel: "Blur:1x1", expected: "20203080" },
        { kernel: "Laplacian:0", expected: "00c00080" },
        { kernel: "Laplacian:1", expected: "00400080" },
        { kernel: "Diamond:1", expected: "00600080" },
        { kernel: "Disk:1", expected: "00600080" },
        { kernel: "Octagon:1", expected: "00600080" },
        { kernel: "Rectangle:3x3", expected: "60606080" },
        { kernel: "Square:1", expected: "60606080" },
        { kernel: "Unity", expected: "10203080" },
        { kernel: "Sobel", expected: "00000080" },
        { kernel: "Gaussian:0x1", expected: "0001062e" },
        { kernel: "Gaussian:2x0.7", expected: "00071400" },
        { kernel: "Gaussian:0.5x1", expected: "090e0980" },
        { kernel: "Blur", expected: "20203080" },
        { kernel: "Blur:0x1", expected: "72203080" },
        { kernel: "Blur:2x0.7", expected: "23203080" },
        { kernel: "Laplacian", expected: "00c00080" },
        { kernel: "Laplacian:2", expected: "00c00080" },
        { kernel: "Laplacian:3", expected: "00000080" },
        { kernel: "Laplacian:5", expected: "0040ff00" },
        { kernel: "Laplacian:7", expected: "00ffffff" },
        { kernel: "Laplacian:15", expected: "0000ff00" },
        { kernel: "Laplacian:19", expected: "000000ff" },
        { kernel: "Laplacian:4", expected: "00c00080" },
        { kernel: "Diamond", expected: "00600080" },
        { kernel: "Diamond:2", expected: "0000e000" },
        { kernel: "Diamond:2x0.5", expected: "00007000" },
        { kernel: "Disk", expected: "000000ff" },
        { kernel: "Disk:2.5", expected: "00e0e000" },
        { kernel: "Octagon", expected: "00e0e000" },
        { kernel: "Octagon:3", expected: "0000ffff" },
        { kernel: "Rectangle", expected: "60606080" },
        { kernel: "Rectangle:2x3", expected: "30306080" },
        { kernel: "Rectangle:3x1", expected: "60203080" },
        { kernel: "Rectangle:1x3", expected: "10304080" },
        { kernel: "Rectangle:7x7", expected: "ffffffff" },
        { kernel: "Rectangle:3x3+3+0", expected: undefined },
        { kernel: "Gaussian:1x1;missing:1", expected: undefined },
        { kernel: "Gaussian:1x1;Disk:1", expected: "090e0980" },
        { kernel: "missing:1", expected: undefined },
    ])(`${mode}: resolves the $kernel color matrix`, async ({ kernel, expected }) => {
        const argv = ["xc:#10203080", "-color-matrix", kernel, "-depth", "8", "rgba:-"];
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
        expect(result.exitCode, result.stderr).toBe(expected === undefined ? 1 : 0);
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(expected ?? "");
        if (expected === undefined) expect(result.stderr).toContain("Invalid color matrix");
        else expect(result.stderr).toBe("");
    });
}
