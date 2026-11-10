import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI isolated color-plane output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "HSL", channel: "R", shape: true, expected: "ff" },
        { space: "Lab", channel: "R", shape: true, expected: "ff" },
        { space: "CMYK", channel: "K", shape: true, expected: "00" },
        { space: "HSL", channel: "R", shape: false, expected: "0c" },
        { space: "Lab", channel: "R", shape: false, expected: "59" },
        { space: "CMYK", channel: "K", shape: false, expected: "7f" },
        { space: "sRGB", channel: "R", shape: true, expected: "ff" },
    ])(`${mode}: $space channel $channel with Shape=$shape`, async ({ space, channel, shape, expected }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = ["xc:#80402860", "-colorspace", space, ...(shape ? ["-alpha", "Shape"] : []),
            "-channel", channel, "-separate", "+channel", "+append", "-depth", "8", "gray:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
