import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI omits disassociated alpha from
// pixel colors while preserving its sample for FX expressions.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { alpha: "disassociate", expected: "Undefined|srgb  4.0|srgb(50%,100%,150%)|0.501961" },
        { alpha: "on", expected: "Blend|srgba 4.0|srgba(64,128,192,0.501961)|0.501961" }
    ])(`${mode}: formatted pixel with alpha $alpha`, async ({ alpha, expected }) => {
        const argv = ["xc:#4080c080", "-alpha", alpha, "-format", "%A|%[channels]|%[pixel:p{0,0}]|%[fx:p{0,0}.a]", "info:"];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
