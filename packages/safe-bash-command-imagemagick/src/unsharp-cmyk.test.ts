import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete CMYK8 output for the two-pixel input.
describe.each(["command", "buffered", "retained", "sync"] as const)("CMYK unsharp (%s)", mode => {
    it.each([
        { name: "default channels", selection: [], expected: "000000c10000005d" },
        { name: "black only", selection: ["-channel", "K"], expected: "000000c10000005d" },
        { name: "red only", selection: ["-channel", "R"], expected: "000000af0000006f" },
    ])("sharpens only selected inks: $name", async ({ selection, expected }) => {
        const args = ["xc:#505050", "xc:#909090", "+append", "-colorspace", "CMYK", ...selection,
            "-unsharp", "1x1+1+0", "+channel", "-depth", "8", "cmyk:-"];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(0);
        expect(error).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
    });
});
