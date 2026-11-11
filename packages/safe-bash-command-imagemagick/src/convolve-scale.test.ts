import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const identity = "0,0,0,0,1,0,0,0,0";
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { options: [], expected: "204060" },
    { options: ["-define", "convolve:scale=100%"], expected: "204060" },
    { options: ["-define", "convolve:scale=50%"], expected: "102030" },
    { options: ["-define", "convolve:scale=50%"], depth: "16", expected: "101020203030" },
    { options: ["-alpha", "set", "-define", "convolve:scale=50%"], output: "rgba:-", expected: "20406080" },
    { options: ["-define", "convolve:scale=0.5"], expected: "102030" },
    { options: ["-define", "convolve:scale=0"], expected: "000000" },
    { options: ["-define", "convolve:scale=200%"], expected: "4080c0" },
    { options: ["-define", "convolve:scale=50%", "+define", "convolve:scale"], expected: "204060" },
    { options: ["-set", "option:convolve:scale", "50%"], expected: "102030" },
    { options: ["-set", "artifact:convolve:scale", "50%"], expected: "102030" },
    { options: ["-define", "convolve:scale=50%"], kernel: "0,0,0,0,2,0,0,0,0", expected: "102030" },
    { options: ["-define", "convolve:scale=50x50%"], expected: "204060" },
    { options: ["-define", "convolve:scale=50%!"], kernel: "0,0,0,0,2,0,0,0,0", expected: "081018" },
    { options: ["-define", "convolve:scale=50%^"], kernel: "0,0,0,0,2,0,0,0,0", expected: "081018" },
    { options: ["-define", "convolve:scale=-50%"], expected: "000000" },
    { options: ["-define", "convolve:scale=x50%"], expected: "306090" },
    { options: ["-define", "convolve:scale=1x-0.5"], expected: "102030" },
    { options: ["-define", "convolve:scale=50,25%"], expected: "183048" },
    { options: ["-define", "convolve:scale=50%", "-convolve", identity], expected: "081018" },
    { options: ["-define", "convolve:scale=50%"], operator: ["-morphology", "Convolve"], kernel: `3x3:${identity}`, expected: "102030" },
    { options: ["-define", "convolve:scale=50%"], operator: ["-morphology", "Correlate"], kernel: `3x3:${identity}`, expected: "102030" },
])(`applies convolution scale (${mode}): $options $operator $kernel`, async ({ options, operator, kernel, depth, output, expected }) => {
    // Native ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGB stdout.
    const args = ["xc:#204060", ...options, ...(operator ?? ["-convolve"]), kernel ?? identity,
        // Retained operations must capture the setting before later changes.
        "-define", "convolve:scale=300%", "-depth", depth ?? "8", output ?? "rgb:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});
