import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw gray16 MSB stdout.
const cases = [
    { name: "Mean above range", before: ["multiply", "3"], statistic: "Mean", after: ["divide", "3"], expected: "55ab8080ab55" },
    { name: "Mean below zero", before: ["subtract", "50%"], statistic: "Mean", after: ["add", "50%"], expected: "55ab8080ab55" },
    { name: "Gradient above range", before: ["multiply", "3"], statistic: "Gradient", after: ["divide", "3"], expected: "404080804040" },
    { name: "multiply/divide control", before: ["multiply", "3"], after: ["divide", "3"], expected: "40408080c0c0" },
    { name: "subtract/add control", before: ["subtract", "50%"], after: ["add", "50%"], expected: "40408080c0c0" },
    { name: "Mean control", statistic: "Mean", expected: "55ab8080ab55" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: retains working samples: $name`, async ({ before, statistic, after, expected }) => {
    const argv = ["xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append",
        ...(before ? ["-evaluate", ...before] : []),
        ...(statistic ? ["-statistic", statistic, "3x1"] : []),
        ...(after ? ["-evaluate", ...after] : []), "-depth", "16", "-endian", "MSB", "gray:-"];
    const stdout: number[] = [];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(...result.stdoutBytes);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.map(value => value.toString(16).padStart(2, "0")).join("")).toBe(expected);
});
