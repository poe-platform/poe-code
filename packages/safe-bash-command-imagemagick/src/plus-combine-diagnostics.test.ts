import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI identifies the operator's one-based CLI position.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const { prefix, operand, suffix, position, expected } of [
    { prefix: [], operand: "zzz", suffix: ["-depth", "8"], position: 3, expected: "" },
    { prefix: [], operand: "-depth", suffix: ["8"], position: 3, expected: "" },
    { prefix: ["-size", "1x1"], operand: "zzz", suffix: ["-depth", "8"], position: 5, expected: "" },
    { prefix: ["("], operand: "zzz", suffix: [")", "-depth", "8"], position: 4, expected: "" },
    { prefix: [], operand: "sRGB", suffix: ["-depth", "8"], position: 3, expected: "361200" },
])
it(`${mode}: +combine ${operand} at CLI arg ${position}`, async () => {
    const args = [...prefix, "xc:red", "xc:blue", "+combine", operand, ...suffix, "rgb:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array)
        stdout = Buffer.from(result.stdoutBytes).toString("hex");
    expect(result.exitCode).toBe(expected ? 0 : 1);
    expect(stdout).toBe(expected);
    expect(stderr).toBe(expected ? "" : `magick: unrecognized colorspace '+combine' '${operand}' at CLI arg ${position}\n`);
});
