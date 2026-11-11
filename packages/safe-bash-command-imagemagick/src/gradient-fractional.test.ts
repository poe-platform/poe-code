import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves fractional gradient samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { format: "%[fx:p{0,1}.r]", expected: "0.5" },
        { format: "%[pixel:p{0,1}]", expected: "srgb(50%,0%,50%)" },
        { format: "%[fx:p{0,0.6}.r]", expected: "0.7" },
        { format: "%[hex:p{0,1}]", expected: "800000008000" },
        { format: "%[fx:p{0,0}.r]", expected: "1" },
        { size: "3x1", format: "%[fx:p{1,0}.r]", expected: "0.5" },
        { options: ["-define", "gradient:direction=east"], format: "%[fx:p{1,0}.r]", expected: "0.5" },
        { size: "5x1", input: "radial-gradient:red-blue", format: "%[fx:p{1,0}.r]", expected: "0.5" },
        { input: "gradient:gray(0%)-gray(100%)", format: "%[fx:p{0,1}.r]", expected: "0.5" },
        { input: "gradient:rgba(255,0,0,0)-blue", format: "%[fx:p{0,1}.a]", expected: "0.5" },
    ])(`${mode}: $input $size $options $format`, async ({ size = "3x3", input = "gradient:red-blue", options = [], format, expected }) => {
        const argv = ["-size", size, ...options, input, "-interpolate", "bilinear", "-format", format, "info:"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let stdout = "", stderr = "";
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
    });
}
