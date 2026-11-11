import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { options: [], exitCode: 0, quiet: false },
        { options: ["-regard-warnings"], exitCode: 1, quiet: false },
        { options: ["-regard-warnings", "-quiet"], exitCode: 1, quiet: true },
        { options: ["-regard-warnings", "+regard-warnings"], exitCode: 0, quiet: false }
    ])(`${mode}: unknown format property $options`, async ({ options, exitCode, quiet }) => {
        const fs = new MemoryFileSystem();
        const args = [...options, "xc:red", "-format", "A%[unknown-property]B", "info:"];
        let result;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result).toEqual({ exitCode, stdout: "AB", stderr: quiet ? "" : "magick: unknown image property '%[unknown-property]'\n" });
    });
}

for (const retained of [false, true]) {
    it(`keeps non-overlapping crop warnings successful (retained=${retained})`, async () => {
        const result = await runMagickCli(["-regard-warnings", "-size", "2x1", "xc:red", "-crop", "1x1+8+8", "-depth", "8", "rgb:-"],
            retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("magick: geometry does not contain image '1x1+8+8'\n");
        expect(result.stdoutBytes).toEqual(new Uint8Array([255, 255, 255]));
    });
}
