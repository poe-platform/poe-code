import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const blur = "3x1:0.25,0.5,0.25";
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { operation: ["-morphology", "Convolve", `${blur};${blur}`], expected: [16, 64, 96, 64, 16] },
    { operation: ["-morphology", "Correlate", `${blur};${blur}`], expected: [16, 64, 96, 64, 16] },
    { operation: ["-convolve", `${blur};${blur}`], expected: [16, 64, 96, 64, 16] },
    { operation: ["-morphology", "Convolve", "3x1:1,0,0;3x1:0,0,1"], expected: [0, 0, 255, 0, 0] },
    { operation: ["-morphology", "Convolve", blur], expected: [0, 64, 128, 64, 0] },
    { operation: ["-morphology", "Convolve:2", blur], expected: [16, 64, 96, 64, 16] },
    { operation: ["-morphology", "Convolve", blur, "-morphology", "Convolve", blur], expected: [16, 64, 96, 64, 16] },
])(`applies numeric kernel sequences (${mode}): $operation`, async ({ operation, expected }) => {
    // Complete RGB output from native ImageMagick 7.1.2-35 Q16-HDRI.
    const args = ["-size", "5x1", "xc:black", "-fill", "white", "-draw", "point 2,0",
        "-virtual-pixel", "edge", ...operation, "-depth", "8", "rgb:-"];
    const fs = new MemoryFileSystem();
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? [...result.stdoutBytes] : stdout).toEqual(expected.flatMap(value => [value, value, value]));
});
