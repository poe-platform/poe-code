import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 pixels from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { gray: true, operation: "Sum", expected: "73c73846" },
        { gray: true, operation: "Max", expected: "4a7d3846" },
        { gray: true, operation: "Mean", expected: "3a641c23" },
        { gray: false, operation: "Sum", expected: "73c782c8" },
    ])(`${mode}: Gray=$gray $operation preserves native channel contributions`, async ({ gray, operation, expected }) => {
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = ["(", "xc:#4a4a4a82", ...(gray ? ["-colorspace", "Gray"] : []), ")",
            "xc:#297d3846", "-evaluate-sequence", operation, "-depth", "8", "rgba:-"];
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
