import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 output and status for empty-stack operations.
describe.each(["command", "buffered", "retained", "sync"] as const)("unsharp image requirement (%s)", mode => {
    it.each([
        [[], ["xc:#78828c"], "", 1],
        [["xc:#78828c", "-delete", "0"], ["xc:#78828c"], "", 1],
        [["xc:#78828c"], [], "78828c", 0],
    ] as const)("requires an image with prefix %j and suffix %j", async (before, after, expected, exitCode) => {
        const args = [...before, "-unsharp", "1x1+1+0", ...after, "-depth", "8", "rgb:-"];
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
        else expect(error).toContain("no images found for operation '-unsharp'");
    });
});
