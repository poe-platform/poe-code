import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Expected destinations from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "retains orientation", orientation: "RightTop", operations: ["-smush", "0"], format: "%[orientation];", expected: "RightTop;" },
        { name: "auto-orients the result", orientation: "RightTop", operations: ["-smush", "0", "-auto-orient"], format: "%wx%h %g %[colorspace] %[channels];", expected: "5x3 5x3+0+0 sRGB srgba 4.0;" },
        { name: "leaves undefined orientation unchanged", orientation: "Undefined", operations: ["-smush", "0", "-auto-orient"], format: "%wx%h %g %[colorspace] %[channels];", expected: "3x5 3x5+0+0 sRGB srgba 4.0;" },
        { name: "retains orientation without smush", orientation: "RightTop", operations: [], format: "%[orientation];", expected: "RightTop;RightTop;" },
    ])(`${mode}: $name`, async ({ orientation, operations, format, expected }) => {
        const argv = ["(", "-size", "2x3", "xc:#8040c080", "-orient", orientation, ")", "-size", "3x2", "xc:#30905040", ...operations, "-format", format, "info:/out"];
        const fs = new MemoryFileSystem();
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        await fs.writeFile("/out", files.get("/out")!);
        const argumentValues = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
