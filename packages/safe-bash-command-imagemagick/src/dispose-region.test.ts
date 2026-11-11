import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "negates the disposal canvas", operations: ["-layers", "Dispose", "-negate"], expected: "000000ffcc99667fcc99667f" },
        { name: "converts the disposal canvas", operations: ["-layers", "Dispose", "-colorspace", "sRGB"], expected: "ffffff003366998033669980" },
        { name: "preserves explicit region reset before negate", operations: ["-layers", "Dispose", "+region", "-negate"], expected: "000000ffcc99667fcc99667f" },
        { name: "preserves explicit region reset before colorspace", operations: ["-layers", "Dispose", "+region", "-colorspace", "sRGB"], expected: "ffffff003366998033669980" },
        { name: "preserves selection without disposal", operations: ["-negate"], expected: "cc99667f39434d80" }
    ])(`${mode}: $name`, async ({ operations, expected }) => {
        const argv = ["(", "-size", "2x1", "xc:#33669980", "-region", "1x1+0+0", "-repage", "3x1+1+0", ")", ...operations, "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
