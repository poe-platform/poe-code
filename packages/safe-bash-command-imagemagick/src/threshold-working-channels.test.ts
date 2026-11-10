import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for xc:#804020.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["HSL", "G", "25%", "G", "ff"],
        ["HSL", "G", "75%", "G", "00"],
        ["Lab", "R", "25%", "R", "ff"],
        ["Lab", "R", "75%", "R", "00"],
        ["HSL", "G", "", "G", "99"],
        ["Lab", "R", "", "R", "59"],
        ["sRGB", "G", "25%", "G", "ff"],
        ["HSL", "R", "25%", "G", "99"],
        ["Lab", "G", "25%", "R", "59"],
    ])(`${mode}: thresholds %s %s at %s then separates %s`, async (colorspace, channel, threshold, output, expected) => {
        const argv = ["xc:#804020", "-colorspace", colorspace, "-channel", channel,
            ...(threshold ? ["-threshold", threshold] : []), "-channel", output, "-separate", "+channel", "-depth", "8", "gray:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
    });
}
