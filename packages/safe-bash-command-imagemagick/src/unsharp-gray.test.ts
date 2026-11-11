import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGB8 output for the two-pixel input.
describe.each(["command", "buffered", "retained", "sync"] as const)("unsharp Gray channels (%s)", mode => {
    it.each([
        ["R", "3e3e3ea2a2a2"],
        ["G", "505050909090"],
        ["B", "505050909090"],
        ["RGB", "3e3e3ea2a2a2"],
        [undefined, "3e3e3ea2a2a2"],
    ] as const)("keeps Gray neutral with channel %s", async (channel, expected) => {
        const args = ["xc:#505050", "xc:#909090", "+append", "-colorspace", "Gray", ...(channel ? ["-channel", channel] : []), "-unsharp", "1x1+1+0", "+channel", "-depth", "8", "rgb:-"];
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
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
        expect(error).toBe("");
    });
});
