import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete big-endian output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { pattern: "horizontal", options: ["-tile-offset", "+1+2"], expected: "ffffffffffffffffff000000" },
        { pattern: "horizontal", options: ["-tile-offset", "-1-1"], expected: "ffffffffffffffffffffffff" },
        { pattern: "horizontal", options: ["-tile-offset", "+0+0"], expected: "00000000ffffffffffffffff" },
        { pattern: "horizontal", options: ["-tile-offset", "+1+2", "+tile-offset"], expected: "00000000ffffffffffffffff" },
        { pattern: "horizontal", options: [], expected: "00000000ffffffffffffffff" },
        { pattern: "left45", options: ["-tile-offset", "+1+2"], expected: "ffffffffffffffffff00ffff" },
        { pattern: "left45", options: ["-tile-offset", "-1-1"], expected: "00ffffffff00ffffffff00ff" },
        { pattern: "left45", options: ["-tile-offset", "-7-7"], expected: "00ffffffffffffffffffffff" },
        { pattern: "left45", options: ["-tile-offset", "+9+9"], expected: "ffffffffffffffffffffffff" },
        { pattern: "left45", options: ["-tile-offset", "-9-9"], expected: "ffffffffffffffffffffffff" },
    ])(`${mode}: pattern:$pattern $options`, async ({ pattern, options, expected }) => {
        const argv = ["-size", "4x3", ...options, `pattern:${pattern}`, "-depth", "8", "gray:-"];
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
