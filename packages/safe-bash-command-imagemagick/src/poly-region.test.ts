import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: polynomial reduction clears region coverage,
// retaining the zero-filled mask channel until +region removes it.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { name: "active region", before: ["-region", "1x1+1+0"], after: [], expected: "9f9f6f009f9f6f009f9f6f00" },
        { name: "explicitly cleared region", before: ["-region", "1x1+1+0"], after: ["+region"], expected: "9f9f6fff9f9f6fff9f9f6fff" },
        { name: "no region", before: [], after: [], expected: "9f9f6fff9f9f6fff9f9f6fff" },
    ])(`${mode}: negates the whole polynomial result with $name`, async ({ before, after, expected }) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = ["-size", "3x1", "xc:#802040", "xc:#40a0e0", ...before,
            "-poly", ".5,1,.5,1", ...after, "-negate", "-depth", "8", "rgba:-"];
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
