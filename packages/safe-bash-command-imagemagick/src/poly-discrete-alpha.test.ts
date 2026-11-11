import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { alpha: "Discrete", expected: "c0908484" },
        { alpha: "Activate", expected: "c0908484" },
        { alpha: "Deactivate", expected: "c0908404" },
    ])(`${mode}: honors $alpha source alpha in polynomial terms`, async ({ alpha, expected }) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = ["-respect-parentheses", "(", "xc:#80402020", ")",
            "(", "xc:#2080c0c0", "-alpha", alpha, ")",
            "-poly", "1,2 0.5,0", "-depth", "8", "rgba:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
