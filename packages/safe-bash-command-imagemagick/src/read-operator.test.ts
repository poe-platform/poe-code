import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "empty list", args: ["-read", "xc:red"], expected: "ff0000" },
        { name: "grouped read", args: ["xc:red", "(", "-read", "xc:blue", "-negate", ")"], expected: "ff0000ffff00" },
        { name: "implicit grouped control", args: ["xc:red", "(", "xc:blue", "-negate", ")"], expected: "ff0000ffff00" },
        { name: "dash-prefixed filename", args: ["xc:red", "-write", "ppm:-sample", "+delete", "-read", "-sample"], expected: "ff0000" },
        { name: "missing input", args: ["-read", "missing.ppm"], error: "unable to open", code: 1 },
        { name: "plus read stays unrecognized", args: ["xc:red", "+read", "xc:blue"], error: "unrecognized option '+read'", code: 11 },
        { name: "missing operand", args: ["xc:red", "-read"], error: "missing argument", code: 1 },
    ])(`${mode}: $name`, async ({ args, expected, error, code }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = ["-depth", "8", ...args, "rgb:-"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(code ?? 0);
        const diagnostics = "stderr" in result ? result.stderr : stderr;
        if (error) { expect(diagnostics).toContain(error); return; }
        expect(diagnostics).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
        expect(output.toString("hex")).toBe(expected);
    });
}
