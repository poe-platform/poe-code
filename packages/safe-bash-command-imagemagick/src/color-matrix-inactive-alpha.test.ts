import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output after reactivation.
const matrices = [
    { name: "alpha to red", matrix: "5x1: 0 0 0 0 1", expected: "80406080", off: "00406000" },
    { name: "red to alpha", matrix: "5x5: 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 1 0 0 0 0", expected: "20406020", off: "20406000" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const alpha of ["active", "Deactivate", "Discrete", "Off"]) {
        it.each(matrices)(`${mode}: color matrix copies $name with ${alpha} alpha`, async ({ matrix, expected, off }) => {
            const argv = ["xc:#20406080", ...(alpha === "active" ? [] : ["-alpha", alpha]),
                "-color-matrix", matrix, "-alpha", "activate", "-depth", "8", "rgba:-"];
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
            expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(alpha === "Off" ? off : expected);
        });
    }
}
