import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output for xc:#345caa80.
describe.each(["command", "buffered", "retained", "sync"] as const)("blue-shift geometry separators (%s)", mode => {
    it.each([
        ...["2,3", "(2,3)", "2/4", "2.0,^", "2", "2x3"].map(factor => ({ factor, expected: "d1dbef80", exitCode: 0 })),
        { factor: "2:4", expected: "3e485c80", exitCode: 0 },
        { factor: "0.5", expected: "3e485c80", exitCode: 0 },
        ...["bogus", "2,bogus", "2/bogus", "", "Infinity"].map(factor => ({ factor, expected: "", exitCode: 1 }))
    ])("parses $factor", async ({ factor, expected, exitCode }) => {
        const args = ["xc:#345caa80", "-blue-shift", factor, "-depth", "8", "rgba:-"];
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
        else expect(error).toContain("invalid argument");
    });
});
