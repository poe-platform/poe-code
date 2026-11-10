import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const)
it.each([
    { name: "Max", operation: ["-evaluate-sequence", "Max"], expected: "e080334b" },
    { name: "Median", operation: ["-evaluate-sequence", "Median"], expected: "e080164b" },
    { name: "Mean control", operation: ["-evaluate-sequence", "Mean"], expected: "79512548" },
    { name: "separation control", operation: ["-channel", "G", "-separate"], expected: "808080ff" },
])(`${mode}: preserves half saturation in $name`, async ({ operation, expected }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
    const inputs = operation[0] === "-evaluate-sequence"
        ? ["xc:#11223344", "(", "xc:#210b1b4b", "-colorspace", "HSL", ")"]
        : ["xc:#210b1b4b", "-colorspace", "HSL"];
    const argv = [...inputs, ...operation, "+channel", "-depth", "8", "rgba:-"];
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const args = createCommandArguments(argv);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout.push(chunk); } },
            stderr: { async write(chunk) { stderr.push(chunk); } },
        })
        : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(mode === "command" ? Buffer.concat(stderr).toString() : result.stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe(expected);
});
