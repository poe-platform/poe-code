import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 treats --list as an input filename.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "bare filename", args: ["--list", "-format", "%wx%h", "info:"], readable: true, exitCode: 0, stdout: "1x1", stderr: "" },
        { name: "relative filename", args: ["./--list", "-format", "%wx%h", "info:"], readable: true, exitCode: 0, stdout: "1x1", stderr: "" },
        { name: "missing filename", args: ["--list", "Metric"], readable: false, exitCode: 1, stdout: "", stderr: expect.stringContaining("unable to open image '--list'") },
        { name: "single-dash query", args: ["-list", "Metric"], readable: true, exitCode: 0, stdout: "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n", stderr: "" }
    ])(`${mode}: $name`, async ({ args, readable, exitCode, stdout, stderr }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        if (readable) {
            const bytes = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
            await filesystem.writeFile("/--list", bytes);
            files.set(args[0] === "./--list" ? "./--list" : "--list", bytes);
        }
        if (mode === "command") {
            let actualStdout = "", actualStderr = "";
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(chunk) { actualStdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { actualStderr += new TextDecoder().decode(chunk); } }
            });
            expect({ exitCode: result.exitCode, stdout: actualStdout, stderr: actualStderr }).toEqual({ exitCode, stdout, stderr });
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode, stdout, stderr });
        }
    });
}
