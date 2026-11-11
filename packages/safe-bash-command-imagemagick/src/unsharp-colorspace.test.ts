import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output for the two-pixel input.
describe.each(["command", "buffered", "retained", "sync"] as const)("unsharp colorspace round trips (%s)", mode => {
    it.each([
        ["Lab", "1x1+1+0", "2b536bff919e84ff"],
        ["HSL", "1x1+1+0", "324163ff959694ff"],
        ["Lab", "1x1+1+1", "406070ff809080ff"],
        ["sRGB", "1x1+1+0", "2e536cff929d84ff"],
    ] as const)("preserves %s unsharp %s", async (space, geometry, expected) => {
        const args = ["xc:#406070", "xc:#809080", "+append", "-colorspace", space, "-unsharp", geometry, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
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
