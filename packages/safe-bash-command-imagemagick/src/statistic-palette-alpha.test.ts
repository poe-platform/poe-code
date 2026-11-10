import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
const cases = [
    { name: "mean class", operation: ["-statistic", "Mean", "3x1"], hex: false, expected: "DirectClass sRGB Alpha|srgba 4.0|3x1" },
    { name: "mean cycle", operation: ["-statistic", "Mean", "3x1", "-cycle", "1"], hex: true, expected: "7b2565bb8080ffff95eb6b1565bbffff606060609b45ffff" },
    { name: "maximum cycle", operation: ["-statistic", "Maximum", "3x1", "-cycle", "1"], hex: true, expected: "d0d0e0e07070ffff8080e0e0c0c0ffffd0d0e0e0c0c0ffff" },
    { name: "palette class control", operation: [], hex: false, expected: "PseudoClass sRGB Alpha|srgba 5.0|3x1" },
    { name: "palette cycle control", operation: ["-cycle", "1"], hex: true, expected: "2020e0e050508080d0d030307070c0c080802020c0c04040" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: $name`, async fixture => {
    const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-type", "PaletteAlpha", ...fixture.operation,
        ...(fixture.hex ? ["-depth", "16", "-endian", "MSB", "rgba:-"] : ["-format", "%r|%[channels]|%wx%h", "info:-"])];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    let stdout = "", stderr = "";
    const args = createCommandArguments(argv);
    let exitCode: number;
    if (mode === "command") {
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += fixture.hex ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        exitCode = result.exitCode;
    } else {
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        stdout = fixture.hex ? Buffer.from(result.stdoutBytes ?? []).toString("hex") : result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode;
    }
    expect(exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(fixture.expected);
});
