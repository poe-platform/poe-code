import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete big-endian output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operation: ["-gamma", "2"], extraction: ["-alpha", "extract"], format: "gray", expected: "b55f" },
        { operation: ["-level", "10%,85%"], extraction: ["-alpha", "extract"], format: "gray", expected: "8933" },
        { operation: ["-sigmoidal-contrast", "5x50%"], extraction: ["-alpha", "extract"], format: "gray", expected: "80bd" },
        { operation: ["-gamma", "2"], extraction: [], format: "rgba", expected: "818181818181b55f" },
        { operation: ["-gamma", "2"], extraction: ["-channel", "A", "-separate", "+channel"], format: "gray", expected: "b55f" },
        { operation: [], extraction: ["-alpha", "extract"], format: "gray", expected: "8080" },
    ])(`${mode}: $operation then $extraction to $format`, async ({ operation, extraction, format, expected }) => {
        const argv = ["xc:#81818180", "-channel", "A", ...operation, "+channel", ...extraction,
            "-depth", "16", "-endian", "MSB", `${format}:-`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
