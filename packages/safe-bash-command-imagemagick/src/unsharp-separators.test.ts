import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output for the two-pixel input.
describe.each(["command", "buffered", "retained", "sync"] as const)("unsharp geometry separators (%s)", mode => {
    it.each([
        ["0x2+0.1+0", "4d3d5effa38392ff", 0],
        ["0,2,0.1,0", "4d3d5effa38392ff", 0],
        ["0/2/0.1/0", "4d3d5effa38392ff", 0],
        ["bad", "", 1],
    ] as const)("parses %s", async (geometry, expected, exitCode) => {
        const args = ["xc:#504060", "xc:#a08090", "+append", "-unsharp", geometry, "-depth", "8", "rgba:-"];
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
        expect(result.exitCode, error).toBe(exitCode);
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
        if (exitCode === 0) expect(error).toBe("");
        else expect(error).toContain("Invalid unsharp geometry");
    });
});
