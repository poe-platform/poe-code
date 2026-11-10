import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw output at depth 8.
const cases = [
    { name: "CMYK round trip without colorization", space: "CMYK", operation: [], output: ["-colorspace", "sRGB", "-depth", "8", "rgba:-"], expected: "4080a080" },
    { name: "zero-strength CMYK round trip", space: "CMYK", operation: ["-colorize", "0"], output: ["-colorspace", "sRGB", "-depth", "8", "rgba:-"], expected: "4080a080" },
    { name: "zero-strength CMY channel round trip", space: "CMYK", operation: ["-channel", "CMY", "-colorize", "0", "+channel"], output: ["-colorspace", "sRGB", "-depth", "8", "rgba:-"], expected: "4080a080" },
    { name: "zero-strength raw CMYK inks", space: "CMYK", operation: ["-colorize", "0", "+channel"], output: ["-depth", "8", "cmyka:-"], expected: "9933005f80" },
    { name: "zero-strength sRGB control", space: "sRGB", operation: ["-colorize", "0"], output: ["-colorspace", "sRGB", "-depth", "8", "rgba:-"], expected: "4080a080" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves $name`, async ({ space, operation, output, expected }) => {
        const args = ["xc:#4080a080", "-colorspace", space, "-fill", "#bf605040", ...operation, ...output];
        const fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
