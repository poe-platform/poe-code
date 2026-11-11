import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick Q16-HDRI retains FX samples until the output coder quantizes them.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const width of [1, 513]) {
        it.each([
            { expression: "0.5", output: ["-depth", "16", "-endian", "MSB", "gray:/out"], expected: "8000" },
            { expression: "0.5", output: ["-depth", "8", "-endian", "MSB", "gray:/out"], expected: "80" },
            { expression: "0", output: ["-depth", "16", "-endian", "MSB", "gray:/out"], expected: "0000" },
            { expression: "1", output: ["-depth", "16", "-endian", "MSB", "gray:/out"], expected: "ffff" },
            { expression: "0.5", output: ["-format", "%[fx:r]", "info:"], expected: "0.5" },
            { expression: "0.5", output: ["-fx", "u", "-format", "%[fx:r]", "info:"], expected: "0.5" }
        ])(`${mode}, width=${width}: -fx $expression $output`, async ({ expression, output, expected }) => {
            const args = ["-size", `${width}x1`, "xc:white", "-fx", expression, ...output];
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const info = output.at(-1) === "info:";
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: info ? expected : "", stderr: "" });
            if (!info) {
                const bytes = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
                expect(Buffer.from(bytes).toString("hex")).toBe(expected.repeat(width));
            }
        });
    }
}
