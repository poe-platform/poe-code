import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: "#406496", factor: "5", clamp: false, expected: "Palette|1.2549|1.96078|2.94118" },
        { color: "#406496", factor: "5", clamp: true, expected: "Bilevel|1|1|1" },
        { color: "#406496", factor: "-1", clamp: false, expected: "Palette|-0.25098|-0.392157|-0.588235" },
        { color: "#406496", factor: "-1", clamp: true, expected: "Bilevel|0|0|0" },
        { color: "white", factor: "2", clamp: false, expected: "Grayscale|2|2|2" },
    ])(`${mode}: $color multiply $factor clamp=$clamp`, async ({ color, factor, clamp, expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = [`xc:${color}`, "-evaluate", "multiply", factor, ...(clamp ? ["-clamp"] : []), "-format", "%[type]|%[fx:r]|%[fx:g]|%[fx:b]", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
