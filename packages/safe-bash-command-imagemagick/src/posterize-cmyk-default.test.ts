import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 bytes for undithered CMYK.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "default", selection: [], expected: "408080ff" },
        { name: "CMY", selection: ["-channel", "CMY"], expected: "50a0a0ff" },
        { name: "CMYK", selection: ["-channel", "CMYK"], expected: "408080ff" },
        { name: "K", selection: ["-channel", "K"], expected: "406680ff" },
        { name: "reset", selection: ["-channel", "CMY", "+channel"], expected: "408080ff" },
    ])(`${mode}: undithered CMYK posterization with $name channels`, async ({ selection, expected }) => {
        const argv = ["xc:#5080a0", "-colorspace", "CMYK", ...selection,
            "+dither", "-posterize", "3", "+channel", "-colorspace", "sRGB", "-depth", "8",
            mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
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
