import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-scale", "-resize", "-thumbnail"]) {
        it.each([
            { geometry: "2:0", format: "rgb", expected: "KEEP", exitCode: 1 },
            { geometry: "0:2", format: "rgb", expected: "KEEP", exitCode: 1 },
            { geometry: "2:0", format: "info", expected: "KEEP", exitCode: 1 },
            { geometry: "0:2", format: "info", expected: "KEEP", exitCode: 1 },
            { geometry: "2:1", format: "info", expected: "5x3", exitCode: 0 },
            { geometry: "2x", format: "info", expected: "2x2", exitCode: 0 },
            { geometry: "x2", format: "info", expected: "3x2", exitCode: 0 },
        ])(`${mode} ${operation} $geometry preserves the destination on failure ($format)`, async ({ geometry, format, expected, exitCode }) => {
            const sentinel = new TextEncoder().encode("KEEP");
            const files = new Map([["/result", sentinel]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/result", sentinel);
            const argv = ["-size", "5x4", "xc:red", operation, geometry, "-depth", "8", "-format", "%wx%h", `${format}:/result`];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(exitCode);
            const diagnostic = "stderr" in result ? result.stderr : stderr;
            if (exitCode === 1) expect(diagnostic).toContain("negative or zero image size");
            else expect(diagnostic).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/result") : files.get("/result")!;
            expect(output).toEqual(new TextEncoder().encode(expected));
        });
    }
}
