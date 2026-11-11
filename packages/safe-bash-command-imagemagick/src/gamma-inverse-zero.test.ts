import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["+gamma", "0"], expected: "00000000" },
        { options: ["+gamma", "-0.0"], expected: "00000000" },
        { options: ["+gamma", "1e-13"], expected: "00000000" },
        { options: ["+gamma", "1e-12"], expected: "00000000" },
        { options: ["+gamma", "-1e-12"], expected: "00000000" },
        { options: ["+gamma", "1.0001e-12"], expected: "ff00ffff" },
        { options: ["-channel", "B", "+gamma", "0", "+channel"], expected: "ff000080" },
        { options: ["-channel", "B", "+gamma", "1e-12", "+channel"], expected: "ff000080" },
        { options: ["-channel", "B", "+gamma", "1e-10", "+channel"], expected: "ff00ff80" },
        { options: ["-channel", "A", "+gamma", "0", "+channel"], expected: "ff004000" },
        { options: ["-gamma", "0"], expected: "ff000000" },
        { options: ["+gamma", "1"], expected: "ff004080" },
    ])(`${mode}: matches native inverse gamma endpoints $options`, async ({ options, expected }) => {
        const argv = ["xc:#ff004080", ...options, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
    });
}
