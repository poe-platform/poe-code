import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { input: ["-type", "Grayscale", "input.ppm"], expected: "Grayscale|srgb(255,0,0);" },
        { input: ["-type", "Grayscale", "xc:red"], expected: "Grayscale|srgb(255,0,0);" },
        { input: ["xc:red", "-write", "mpr:a", "+delete", "-type", "Grayscale", "mpr:a"], expected: "Grayscale|srgb(255,0,0);" },
        { input: ["-type", "Grayscale", "xc:red", "xc:blue"], expected: "Grayscale|srgb(255,0,0);Grayscale|srgb(0,0,255);" },
        { input: ["xc:red", "-type", "Grayscale", "+delete", "xc:blue"], expected: "Grayscale|srgb(0,0,255);" },
        { input: ["-type", "Grayscale", "-type", "TrueColor", "xc:red"], expected: "Palette|srgb(255,0,0);" },
        { input: ["xc:red", "-type", "Grayscale"], format: "%[type]", expected: "Grayscale" },
    ])(`retains the requested input type without converting pixels (${mode}): $input`, async ({ input, format, expected }) => {
        const fixture = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
        const files = new Map([["input.ppm", fixture]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", fixture);
        const args = [...input, "-format", format ?? "%[type]|%[pixel:p{0,0}];", "info:"];
        let stdout = "", stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
    });
}
