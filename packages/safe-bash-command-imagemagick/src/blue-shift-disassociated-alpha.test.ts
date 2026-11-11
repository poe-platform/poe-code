import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inspect alpha before reactivation, which can hide
// the discarded channel by initializing opaque samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "disassociate", operations: [], expected: "srgb  4.0/0.501961" },
        { alpha: "disassociate", operations: ["-blue-shift", "1"], expected: "srgb  3.0/1" },
        { alpha: "disassociate", operations: ["-blue-shift", "1", "-alpha", "activate"], expected: "srgba 4.0/0" },
        { alpha: "disassociate", operations: ["-blue-shift", "1", "-alpha", "on"], expected: "srgba 4.0/1" },
        ...["on", "associate", "deactivate", "discrete"].map(alpha => ({
            alpha, operations: ["-blue-shift", "1"], expected: "srgba 4.0/0.501961"
        }))
    ])(`${mode}: $alpha with $operations reports $expected`, async ({ alpha, operations, expected }) => {
        const argv = ["xc:#4080c080", "-alpha", alpha, ...operations,
            "-format", "%[channels]/%[fx:p{0,0}.a]", "info:"];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
