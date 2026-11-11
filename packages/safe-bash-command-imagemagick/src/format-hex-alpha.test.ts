import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI includes retained alpha in hex pixel expressions.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each(["discrete", "deactivate", "off", "on"])(`${mode}: ${depth}-bit hex pixel after alpha %s`, async alpha => {
            const filesystem = new MemoryFileSystem();
            const argv = ["xc:#2878a080", "-alpha", alpha, "-depth", String(depth), "-format", "%[channels] %[hex:p{0,0}]", "info:"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
            const hex = depth === 8 ? "2878A0" : "28287878A0A0";
            const expected = alpha === "off" ? `srgb  3.0 ${hex}` : `srgba 4.0 ${hex}${depth === 8 ? "80" : "8080"}`;
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        });
    }
}
