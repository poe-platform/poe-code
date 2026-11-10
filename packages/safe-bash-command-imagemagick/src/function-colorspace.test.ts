import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 bytes after conversion to sRGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "HSL", coefficients: "1,0", selection: [], expected: "20406080" },
        { space: "HSL", coefficients: "0.5,0", selection: [], expected: "1c281840" },
        { space: "HSL", coefficients: "0.5,0", selection: ["-channel", "A"], expected: "20406040" },
        { space: "Lab", coefficients: "1,0", selection: [], expected: "20406080" },
        { space: "Lab", coefficients: "0.5,0", selection: [], expected: "007db140" },
        { space: "Lab", coefficients: "0.5,0", selection: ["-channel", "A"], expected: "20406040" },
    ])(`${mode}: preserves $space Polynomial $coefficients with $selection`, async ({ space, coefficients, selection, expected }) => {
        const argv = ["xc:#20406080", "-colorspace", space, ...selection,
            "-function", "Polynomial", coefficients, "+channel", "-colorspace", "sRGB",
            "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
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
        const output = mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(output).toBe(expected);
    });
}
