import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const omitted of ["nan", "-", "0"])
it.each([
    { operator: ["-morphology", "Correlate"], weights: `0,${omitted},1` },
    { operator: ["-morphology", "Convolve"], weights: `1,${omitted},0` },
    { operator: ["-convolve"], weights: `0,${omitted},1` },
])(`preserves kernel positions (${mode}): $operator $weights`, async ({ operator, weights }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI: morphology skips omitted taps;
    // standalone convolution produces a black row for these sparse kernels.
    const args = ["-size", "5x1", "xc:black", "-fill", "white", "-draw", "point 2,0",
        "-virtual-pixel", "edge", ...operator, `3x1:${weights}`, "-depth", "8", "rgb:-"];
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
    const expected = operator[0] === "-convolve" && omitted !== "0" ? [0, 0, 0, 0, 0] : [0, 255, 0, 0, 0];
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? [...result.stdoutBytes] : stdout)
        .toEqual(expected.flatMap(value => [value, value, value]));
});
