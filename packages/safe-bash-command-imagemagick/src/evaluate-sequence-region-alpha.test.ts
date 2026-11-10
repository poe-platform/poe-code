import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a region leaves a zero-filled write mask after Mean.
for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each([
        { name: "retained region mask", before: ["-region", "1x1+1+0"], after: [], hex: "9f9f6f009f9f6f009f9f6f00" },
        { name: "removed write mask", before: ["-region", "1x1+1+0"], after: ["+write-mask"], hex: "9f9f6fff9f9f6fff9f9f6fff" },
        { name: "no region", before: [], after: [], hex: "9f9f6fff9f9f6fff9f9f6fff" },
    ])(`${mode}: $name`, async ({ before, after, hex }) => {
        const fs = new MemoryFileSystem();
        const args = ["-size", "3x1", "xc:#802040", "xc:#40a0e0", ...before,
            "-evaluate-sequence", "mean", ...after, "-negate", "-depth", "8", "rgba:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
