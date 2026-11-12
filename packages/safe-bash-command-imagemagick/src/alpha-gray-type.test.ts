import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: enabling alpha updates the Gray conversion's
// explicit type; On/Set leave it alone when alpha is already enabled.
for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "", operations: [], expected: "Grayscale|gray  1.0" },
        ...["On", "Set", "Discrete", "Deactivate"].map(mode => ({
            alpha: "", operations: ["-alpha", mode], expected: "GrayscaleAlpha|graya 2.0",
        })),
        { alpha: "", operations: ["-alpha", "On", "-unique-colors"], expected: "GrayscaleAlpha|graya 2.0" },
        ...["On", "Set"].map(mode => ({
            alpha: "80", operations: ["-alpha", mode], expected: "Grayscale|graya 2.0",
        })),
        { alpha: "80", operations: ["-alpha", "Discrete"], expected: "GrayscaleAlpha|graya 2.0" },
        { alpha: "", operations: ["-alpha", "On", "-alpha", "Off"], expected: "Grayscale|gray  1.0" },
        { alpha: "", operations: ["-alpha", "On", "-alpha", "Extract"], expected: "Bilevel|gray  1.0" },
        ...["black", "white"].flatMap(color => ["On", "Discrete"].map(mode => ({
            color, alpha: "", operations: ["-alpha", mode], expected: "Bilevel|graya 2.0",
        }))),
    ].map(entry => ({ color: "#123456", ...entry })))(`${execution}: $color Gray with alpha '$alpha' then $operations`, async ({ color, alpha, operations, expected }) => {
        const argv = [`xc:${color}${alpha}`, "-colorspace", "Gray", ...operations,
            "-format", "%[type]|%[channels]", "info:"];
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : execution === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
