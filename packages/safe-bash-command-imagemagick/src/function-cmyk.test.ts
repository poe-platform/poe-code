import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "identity", selection: [], coefficients: "1,0", expected: "20406080" },
        { name: "default inks and alpha", selection: [], coefficients: "0.5,0", expected: "7592b040" },
        { name: "cyan", selection: ["-channel", "R"], coefficients: "0.5,0", expected: "40406080" },
        { name: "alpha", selection: ["-channel", "A"], coefficients: "0.5,0", expected: "20406040" },
        { name: "magenta", selection: ["-channel", "G"], coefficients: "0.5,0", expected: "20506080" },
        { name: "black", selection: ["-channel", "K"], coefficients: "0.5,0", expected: "3b75b080" },
        { name: "explicit Default", selection: ["-channel", "Default"], coefficients: "0.5,0", expected: "7592b040" },
        { name: "All", selection: ["-channel", "All"], coefficients: "0.5,0", expected: "7592b040" },
        { name: "reset selection", selection: ["-channel", "A", "+channel"], coefficients: "0.5,0", expected: "7592b040" },
    ])(`${mode}: Polynomial transforms CMYK $name`, async ({ selection, coefficients, expected }) => {
        const argv = ["xc:#20406080", "-colorspace", "CMYK", ...selection,
            "-function", "Polynomial", coefficients, "+channel", "-colorspace", "sRGB", "-depth", "8",
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
