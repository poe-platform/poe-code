import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Discrete samples participate in
// reductions, while output transparency retains the selected canvas's trait.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { first: "Activate", second: "Discrete", operation: "Mean", output: [], expected: "50607070" },
    { first: "Discrete", second: "Activate", operation: "Mean", output: ["-alpha", "Activate"], depth: "16", expected: "5030606070707071" },
    { first: "Discrete", second: "Activate", operation: "Median", output: ["-alpha", "Activate"], depth: "16", expected: "20208080c0c0c0c1" },
    { first: "Discrete", second: "Activate", operation: "Max", output: ["-alpha", "Activate"], depth: "16", expected: "80408080c0c0c0c1" },
    { first: "Activate", second: "Discrete", operation: "Median", output: [], expected: "2080c0c0" },
    { first: "Discrete", second: "Activate", operation: "Mean", output: ["-alpha", "Activate"], expected: "50607070" },
    { first: "Discrete", second: "Activate", operation: "Mean", output: [], expected: "506070ff" },
    { first: "Discrete", second: "Discrete", operation: "Max", output: ["-alpha", "Extract"], expected: "c0c0c0ff" },
    { first: "Discrete", second: "Discrete", operation: "Median", output: ["-alpha", "Activate"], expected: "2080c0c0" },
    { first: "Off", second: "Discrete", operation: "Mean", output: ["-alpha", "Activate"], expected: "50607060" },
    { first: "Discrete", second: "Off", operation: "Mean", output: ["-alpha", "Activate"], expected: "50607010" },
    { first: "Activate", second: "Deactivate", operation: "Mean", output: [], expected: "50607010" },
    { first: "Activate", second: "Activate", operation: "Mean", output: [], expected: "50607070" },
    { first: "Activate", second: "Activate", operation: "Median", output: [], expected: "2080c0c0" },
    { first: "Activate", second: "Discrete", operation: "Mean", output: ["PNG32:-"], expected: "50607070" },
])(`${mode}: $first / $second, $operation, $output`, async ({ first, second, operation, output, depth = "8", expected }) => {
    const png = output.at(-1) === "PNG32:-";
    const argv = ["-respect-parentheses", "(", depth === "16" ? "xc:#8040404020202021" : "xc:#80402020", "-alpha", first, ")", "(", depth === "16" ? "xc:#20208080c0c0c0c1" : "xc:#2080c0c0", "-alpha", second, ")", "-evaluate-sequence", operation, ...output, ...(png ? [] : ["-depth", depth, "-endian", "MSB", "rgba:-"])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
