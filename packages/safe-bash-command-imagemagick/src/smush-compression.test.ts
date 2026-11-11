import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 reports the first image's compression before output encoding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { name: "default compression", inputs: ["xc:red", "xc:blue"], expected: "Undefined" },
            { name: "single image", inputs: ["xc:red"], expected: "Undefined" },
            { name: "first image RLE", inputs: ["(", "xc:red", "-compress", "RLE", ")", "xc:blue"], expected: "RLE" },
            { name: "single image RLE", inputs: ["(", "xc:red", "-compress", "RLE", ")"], expected: "RLE" },
            { name: "second image RLE", inputs: ["xc:red", "(", "xc:blue", "-compress", "RLE", ")"], expected: "Undefined" },
            { name: "different compressions", inputs: ["(", "xc:red", "-compress", "RLE", ")", "(", "xc:blue", "-compress", "Zip", ")"], expected: "RLE" },
        ])(`${mode}: ${operation} preserves $name`, async ({ inputs, expected }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argv = ["-respect-parentheses", ...inputs, operation, "0", "-format", "%[compression]", "info:"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe(expected);
        });
    }
}
