import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI discards disassociated alpha after ordered dithering.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "disassociate", operations: ["-alpha", "activate"], expected: "0.501961" },
        { alpha: "disassociate", operations: ["-ordered-dither", "o4x4,4", "-alpha", "activate"], expected: "0" },
        { alpha: "deactivate", operations: ["-ordered-dither", "o4x4,4", "-alpha", "activate"], expected: "0.501961" },
    ])(`${mode}: $alpha with $operations reports $expected`, async ({ alpha, operations, expected }) => {
        const argv = ["-size", "4x4", "xc:#20406080", "-alpha", alpha, ...operations,
            "-format", "%[fx:a]", "info:"];
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
