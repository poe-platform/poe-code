import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA8 reference pixels.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
it.each([
    { name: "expanded first input", size: "2x1", pixels: 2, expected: "ff708080" },
    { name: "equal dimensions control", size: "1x1", pixels: 1, expected: "ff708080" },
    { name: "reversed inputs control", size: "2x1", pixels: 2, reverse: true, expected: "ff708080" },
    { name: "unscaled control", size: "2x1", pixels: 2, unscaled: true, expected: "d0605060" },
    { name: "expanded rows", size: "1x2", pixels: 2, expected: "ff708080" },
    { name: "working-plane chunk boundary", size: "514x1", firstSize: "513x1", pixels: 514, expected: "ff708080" },
])(`${mode}: preserves Mean operands during canvas expansion ($name)`, async ({ size, firstSize, pixels, reverse, unscaled, expected }) => {
    const inputs = [
        ["(", ...(firstSize ? ["-size", firstSize] : []), "xc:#e0206040", ...(unscaled ? [] : ["-evaluate", "multiply", "2"]), ")"],
        ["(", "-size", size, "xc:#c0a04080", ")"],
    ];
    if (reverse) inputs.reverse();
    const argv = [...inputs.flat(), "-evaluate-sequence", "Mean", "-depth", "8", "rgba:-"];
    const args = createCommandArguments(argv), fs = new MemoryFileSystem();
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const files = new Map<string, Uint8Array>();
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe(expected.repeat(pixels));
});
