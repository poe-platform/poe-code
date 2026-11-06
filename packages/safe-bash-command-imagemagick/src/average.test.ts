import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
    it.each([["-average"], ["-evaluate-sequence", "Mean"]])(`averages the sequence via ${mode}: %s`, async (...operator) => {
        const args = ["-size", "2x2", "xc:red", "-size", "2x2", "xc:blue", ...operator, "-format", "%wx%h %[pixel:p{0,0}]\\n", "info:"];
        const fs = createMemoryFileSystem();
        let stdout = "", stderr = "";
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
                stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
            ({ exitCode, stdout, stderr } = result);
        }
        expect(exitCode).toBe(0);
        expect(stdout).toBe("2x2 srgb(128,0,128)\n");
        if (operator[0] === "-average") expect(stderr).toContain('option has been replaced \'-average\', use "-evaluate-sequence Mean"');
        else expect(stderr).toBe("");
    });
}
