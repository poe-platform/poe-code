import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI distinguishes deprecated plus forms from unknown options.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const destination of ["-", "out"]) {
        it.each([
            { option: "+auto-level", exitCode: 1 },
            { option: "+auto-gamma", exitCode: 1 },
            { option: "+normalize", exitCode: 1 },
            { option: "-garbage", exitCode: 11 }
        ])(`matches native status and output for $option (${mode}, ${destination})`, async ({ option, exitCode }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", original);
            const args = ["xc:red", option, "-depth", "8", `rgb:${destination}`];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(exitCode);
            expect(result.stdout).toBe("");
            expect("stdoutBytes" in result ? result.stdoutBytes?.length ?? 0 : 0).toBe(0);
            expect(result.stderr).toBe(exitCode === 1 ? `magick: option deprecated, unable to execute '${option}'\n`
                : `magick: unrecognized option '${option}'\n`);
            expect(mode === "buffered" || mode === "sync" ? files.get("out") : await filesystem.readFile("/out"))
                .toEqual(original);
        });
    }
}
