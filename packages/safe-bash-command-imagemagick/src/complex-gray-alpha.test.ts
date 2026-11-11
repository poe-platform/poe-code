import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 component pixels.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { operation: "Add", gray: 0, count: 2, part: 0, opaque: false, expected: "5c5c5c80" },
    { operation: "MagnitudePhase", gray: 1, count: 2, part: 1, opaque: false, expected: "afafafb1" },
    { operation: "Add", gray: 2, count: 4, part: 1, opaque: false, expected: "70906080" },
    { operation: "Subtract", gray: 2, count: 4, part: 0, opaque: false, expected: "00104040" },
    { operation: "Multiply", gray: 2, count: 4, part: 0, opaque: false, expected: "00004040" },
    { operation: "Multiply", gray: 2, count: 4, part: 1, opaque: false, expected: "1e166080" },
    { operation: "Divide", gray: 2, count: 4, part: 0, opaque: false, expected: "8cff4040" },
    { operation: "Divide", gray: 2, count: 4, part: 1, opaque: false, expected: "67006080" },
    { operation: "RealImaginary", gray: 1, count: 2, part: 0, opaque: false, expected: "0b304040" },
    { operation: "RealImaginary", gray: 1, count: 2, part: 1, opaque: false, expected: "00000001" },
    { operation: "Conjugate", gray: 1, count: 2, part: 1, opaque: false, expected: "00000000" },
    { operation: "Add", gray: 3, count: 4, part: 0, opaque: false, expected: "70904040" },
    { operation: "Add", gray: 3, count: 4, part: 1, opaque: false, expected: "7f806080" },
    { operation: "Add", gray: 0, count: 2, part: 1, opaque: false, expected: "80a06080" },
    { operation: "MagnitudePhase", gray: 1, count: 2, part: 0, opaque: false, expected: "54894040" },
    { operation: "Add", gray: 2, count: 4, part: 0, opaque: false, expected: "7e504040" },
    { operation: "Add", gray: 0, count: 2, part: 1, opaque: true, expected: "805060ff" },
    { operation: "Add", gray: -1, count: 2, part: 0, opaque: false, expected: "40608080" },
    { operation: "MagnitudePhase", gray: -1, count: 2, part: 0, opaque: false, expected: "485d738f" },
])(`${mode}: complex $operation with gray operand $gray, $count inputs, output $part, opaque=$opaque`, async ({ operation, gray, count, part, opaque, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const inputs = ["xc:#20304040", "xc:#40506080", "xc:#50607020", "xc:#30406030"];
    const argv = ["-respect-parentheses", ...inputs.slice(0, count).flatMap((input, index) =>
        ["(", opaque ? input.slice(0, -2) : input, ...(index === gray ? ["-colorspace", "Gray"] : []), ")"]),
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
