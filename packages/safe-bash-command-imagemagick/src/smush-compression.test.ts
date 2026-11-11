import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 reports the first image's compression before output encoding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush", "+append", "-append"]) {
        it.each([
            { name: "PPM first", inputs: ["/in.ppm", "xc:red"], expected: "Undefined" },
            { name: "PPM second", inputs: ["xc:red", "/in.ppm"], expected: "Undefined" },
            { name: "single PPM", inputs: ["/in.ppm"], expected: "Undefined" },
            { name: "PPM explicit compression", inputs: ["(", "/in.ppm", "-compress", "RLE", ")", "xc:red"], expected: "RLE" },
            { name: "default compression", inputs: ["xc:red", "xc:blue"], expected: "Undefined" },
            { name: "single image", inputs: ["xc:red"], expected: "Undefined" },
            { name: "first image RLE", inputs: ["(", "xc:red", "-compress", "RLE", ")", "xc:blue"], expected: "RLE" },
            { name: "single image RLE", inputs: ["(", "xc:red", "-compress", "RLE", ")"], expected: "RLE" },
            { name: "second image RLE", inputs: ["xc:red", "(", "xc:blue", "-compress", "RLE", ")"], expected: "Undefined" },
            { name: "different compressions", inputs: ["(", "xc:red", "-compress", "RLE", ")", "(", "xc:blue", "-compress", "Zip", ")"], expected: "RLE" },
        ])(`${mode}: ${operation} preserves $name`, async ({ inputs, expected }) => {
            const files = new Map([["/in.ppm", new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130])]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["-respect-parentheses", ...inputs, operation, ...(operation.endsWith("smush") ? ["1"] : []), "-format", "%C|%[compression]", "info:"];
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
            expect("stdout" in result ? result.stdout : stdout).toBe(`${expected}|${expected}`);
        });
    }
}
