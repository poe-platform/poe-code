import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs, including unchanged invalid-mode output.
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "#80502080", alpha: ["-alpha", "Undefined"], output: ["-depth", "8", "rgba:out"], hex: "80502080", exitCode: 0 },
        { color: "#80502080", alpha: ["-alpha", "Undefined"], output: ["-format", "%[opaque]", "info:out"], hex: "46616c7365", exitCode: 0 },
        { color: "#abcdef", alpha: ["-alpha", "Undefined"], output: ["-depth", "8", "rgba:out"], hex: "abcdefff", exitCode: 0 },
        { color: "#80502080", alpha: [], output: ["-depth", "8", "rgba:out"], hex: "80502080", exitCode: 0 },
        { color: "#80502080", alpha: [], output: ["-format", "%[opaque]", "info:out"], hex: "46616c7365", exitCode: 0 },
        { color: "#abcdef80", alpha: ["-alpha", "bogus"], output: ["-depth", "8", "rgba:out"], hex: "4b454550", exitCode: 1 },
        { color: "#80502080", alpha: ["-alpha", "uNdEfInEd"], output: ["-depth", "8", "rgba:out"], hex: "80502080", exitCode: 0 },
        { color: "#123456789abc8001", alpha: ["-alpha", "Undefined"], output: ["-depth", "16", "-endian", "MSB", "rgba:out"], hex: "123456789abc8001", exitCode: 0 },
    ])(`${execution}: $color $alpha $output`, async ({ color, alpha, output, hex, exitCode }) => {
        const argv = [`xc:${color}`, ...alpha, ...output];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = execution === "sync" ? runMagickCliSync(argv, files)
            : execution === "buffered" ? await runMagickCli(argv, files)
            : execution === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr };
        expect(result).toMatchObject({ exitCode, stdout: "", stderr: exitCode ? "magick: Unsupported alpha mode: bogus\n" : "" });
        const bytes = execution === "command" || execution === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
