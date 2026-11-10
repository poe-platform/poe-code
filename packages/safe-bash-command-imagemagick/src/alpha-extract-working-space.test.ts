import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "HSL", extract: true, expected: "3c844fff" },
        { space: "HSB", extract: true, expected: "3c6045ff" },
        { space: "Lab", extract: true, expected: "00829eff" },
        { space: "CMYK", extract: true, expected: "636363ff" },
        { space: "sRGB", extract: true, expected: "606060ff" },
        { space: "HSL", extract: false, expected: "80382060" },
        { space: "CMYK", extract: false, expected: "80382060" },
    ])(`${mode}: $space alpha extraction=$extract before sRGB conversion`, async ({ space, extract, expected }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = ["xc:#80382060", "-colorspace", space, ...(extract ? ["-alpha", "extract"] : []),
            "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
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
