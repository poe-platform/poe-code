import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps the source color channels after alpha extraction.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "sRGB", extract: true, raw: false, expected: "sRGB|srgb  3.0" },
        { space: "HSL", extract: true, raw: false, expected: "HSL|hsl  3.0" },
        { space: "CMYK", extract: true, raw: false, expected: "CMYK|cmyk  4.0" },
        { space: "sRGB", extract: true, raw: true, expected: "60" },
        { space: "sRGB", extract: false, raw: false, expected: "sRGB|srgba 4.0" },
    ])(`${mode}: $space, extract=$extract, raw=$raw`, async ({ space, extract, raw, expected }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = ["xc:#80382060", "-colorspace", space, ...(extract ? ["-alpha", "extract"] : []),
            ...(raw ? ["-depth", "8", "gray:out"] : ["-format", "%[colorspace]|%[channels]", "info:out"])];
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
        expect(Buffer.from(output).toString(raw ? "hex" : "utf8")).toBe(expected);
    });
}
