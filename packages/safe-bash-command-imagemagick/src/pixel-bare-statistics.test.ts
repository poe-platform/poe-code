import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: bare statistics are zero in the red
// component of pixel expressions; image-qualified and scalar FX values differ.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        ["pixel:mean", "srgb(0,85,85)"],
        ["pixel:mean.r", "srgb(0,255,255)"],
        ["pixel:maxima", "srgb(0,255,255)"],
        ["pixel:u.mean", "srgb(85,85,85)"],
        ["fx:mean", "0.333333"],
        ["pixel:0.5", "srgb(50%,50%,50%)"],
        ["pixel:mean+u.mean", "srgb(85,170,170)"],
    ])(`${mode}: formats red pixel %s`, async (property, expected) => {
        const argv = ["xc:red", "-format", `%[${property}]`, "info:"];
        const fs = new MemoryFileSystem();
        let result;
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const execution = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            result = { ...execution, stdout, stderr };
        } else {
            result = mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        }
        expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
