import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI drops disassociated alpha even when
// solarize changes no samples; Discrete and Deactivate retain their channels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "disassociate", operations: [], expected: "srgb  4.0|0.501961" },
        { alpha: "disassociate", operations: ["-alpha", "activate"], expected: "srgba 4.0|0.501961" },
        ...["30%", "100%"].flatMap(threshold => [
            { alpha: "disassociate", operations: ["-solarize", threshold], expected: "srgb  3.0|1" },
            { alpha: "disassociate", operations: ["-solarize", threshold, "-alpha", "activate"], expected: "srgba 4.0|0" },
            { alpha: "disassociate", operations: ["-solarize", threshold, "-alpha", "on"], expected: "srgba 4.0|1" }
        ]),
        ...["discrete", "on"].map(alpha => ({
            alpha, operations: ["-solarize", "30%", "-alpha", "activate"], expected: "srgba 4.0|0.498039"
        })),
        ...["deactivate", "associate"].map(alpha => ({
            alpha, operations: ["-solarize", "30%", "-alpha", "activate"], expected: "srgba 4.0|0.501961"
        }))
    ])(`${mode}: $alpha with $operations reports $expected`, async ({ alpha, operations, expected }) => {
        const argv = ["-size", "3x2", "xc:#20406080", "-alpha", alpha, ...operations,
            "-format", "%[channels]|%[fx:a]", "info:"];
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
