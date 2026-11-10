import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Gray", "", "1e1e1e40"],
        ["Gray", "R", "1e1e1e80"],
        ["Gray", "A", "3c3c3c40"],
        ["Gray", "G", "3c3c3c80"],
        ["LinearGray", "", "2b2b2b40"],
        ["LinearGray", "R", "2b2b2b80"],
        ["LinearGray", "A", "3e3e3e40"],
        ["LinearGray", "G", "3e3e3e80"],
    ])(`${mode}: %s function respects channel %s`, async (colorspace, channel, expected) => {
        const argv = ["xc:#20406080", "-colorspace", colorspace,
            ...(channel ? ["-channel", channel] : []), "-function", "Polynomial", "0.5,0",
            "+channel", "-colorspace", "sRGB", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
