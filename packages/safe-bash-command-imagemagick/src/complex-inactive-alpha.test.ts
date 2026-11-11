import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 results.

for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { operation: "Add", alphaMode: "Discrete", operand: 1, count: 2, part: 0, expected: "40608080" },
    { operation: "Add", alphaMode: "Deactivate", operand: 0, count: 2, part: 1, expected: "80a0c0ff" },
    { operation: "Multiply", alphaMode: "Discrete", operand: 2, count: 4, part: 1, expected: "1a2a421c" },
    { operation: "Add", alphaMode: "On", operand: 1, count: 2, part: 0, expected: "40608080" },
    { operation: "Add", alphaMode: "Off", operand: 1, count: 2, part: 0, expected: "40608040" },
    { operation: "Multiply", alphaMode: "On", operand: 2, count: 4, part: 1, expected: "1a2a421c" },
])(`${mode}: complex $operation reads $alphaMode alpha from operand $operand for output $part`, async ({ operation, alphaMode, operand, count, part, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const inputs = ["xc:#20304040", "xc:#40506080", "xc:#50607020", "xc:#30406030"];
    const argv = ["-respect-parentheses", ...inputs.slice(0, count).flatMap((input, index) =>
        ["(", input, ...(index === operand ? ["-alpha", alphaMode] : []), ")"]),
        "-complex", operation, "-delete", String(1 - part), "+region", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
