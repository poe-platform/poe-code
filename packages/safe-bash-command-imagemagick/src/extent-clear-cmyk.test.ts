import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI clears all four CMYK inks, including black.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const evaluate of [false, true]) it.each([
        { space: "CMYK", output: ["-depth", "8", "cmyka:-"], expected: "0000000000" },
        { space: "CMYK", output: ["-alpha", "off", "-colorspace", "sRGB", "-depth", "8", "rgb:-"], expected: "ffffff" },
        { space: "sRGB", output: ["-alpha", "off", "-depth", "8", "rgb:-"], expected: "000000" },
    ])(`${mode}: Clear extent in $space produces $expected (evaluate=${evaluate})`, async ({ space, output, expected }) => {
        const argv = ["xc:#b5267382", "-colorspace", space, ...(evaluate ? ["-evaluate", "Add", "0"] : []),
            "-background", "white", "-compose", "Clear", "-extent", "1x1", ...output];
        const fs = new MemoryFileSystem(), argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
    });
}
