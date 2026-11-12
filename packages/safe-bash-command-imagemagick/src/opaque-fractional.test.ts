import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a later multiply exposes retained sub-byte RGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { add: "0.25", paint: ["-fill", "blue", "-opaque", "white"], expected: "09c400000000" },
        { add: "0.25", paint: ["-transparent", "white"], expected: "09c400000000" },
        { add: "0.25", paint: [], expected: "09c400000000" },
        { add: "1", paint: ["-fill", "blue", "-opaque", "white"], expected: "271000000000" },
    ])(`${mode}: preserves working samples after add $add and $paint`, async ({ add, paint, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:black", "-channel", "R", "-evaluate", "add", add, "+channel", ...paint,
            "-channel", "R", "-evaluate", "multiply", "10000", "+channel", "-depth", "16", "-endian", "MSB", "rgb:-"];
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr, stdoutBytes: Buffer.concat(chunks) } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
    });
}
