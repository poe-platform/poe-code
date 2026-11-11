import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["xc:red", "-print", "OK", "null:"], stdout: "OK" },
        { args: ["-size", "2x1", "xc:red", "-size", "3x1", "xc:blue", "-print", "%s/%p/%n:%wx%h;", "null:"], stdout: "0/0/2:2x1;" },
        { args: ["-size", "2x1", "xc:red", "-size", "3x1", "xc:blue", "-format", "W%w;", "-write", "info:", "-print", "P%w;", "null:"], stdout: "W2;W3;P2;" },
        { args: ["-size", "2x1", "xc:red", "-size", "3x1", "xc:blue", "-format", "W%w;", "-print", "P%w;", "-write", "info:", "-reverse", "-print", "R%w;", "info:"], stdout: "P2;W2;W3;R3;W3;W2;" },
        { args: ["-size", "2x1", "xc:red", "-print", "%w;", "-resize", "1x1!", "-print", "%w;", "null:"], stdout: "2;1;" },
        { args: ["xc:red", "-print", "", "-format", "TXT", "info:"], stdout: "TXT" },
        { args: ["xc:red", "-print", "%%w\\n", "null:"], stdout: "%w\n" }
    ])(`${mode}: prints once at the current argument position: $args`, async ({ args, stdout }) => {
        const fs = new MemoryFileSystem();
        const expected = { exitCode: 0, stdout, stderr: "" };
        if (mode === "command") {
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ exitCode: result.exitCode, stdout, stderr }).toEqual(expected);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
            expect(result).toEqual(expected);
        }
    });
}
