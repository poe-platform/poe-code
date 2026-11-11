import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, real/imaginary results individually converted to RGBA8.
for (const mode of ["buffered", "sync", "retained", "command"])
for (const part of [0, 1])
it.each([
    { name: "2 operands, CMYK [0], Add", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "Add", expected: ["00000040", "80a0c0ff"] },
    { name: "2 operands, CMYK [0], Subtract", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "Subtract", expected: ["ffffff40", "00000000"] },
    { name: "2 operands, CMYK [0], Multiply", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "Multiply", expected: ["8fb7c940", "402800c0"] },
    { name: "2 operands, CMYK [0], Divide", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "Divide", expected: ["00000040", "00000000"] },
    { name: "2 operands, CMYK [0], Conjugate", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "Conjugate", expected: ["20304040", "00000000"] },
    { name: "2 operands, CMYK [0], MagnitudePhase", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "MagnitudePhase", expected: ["0b0f1040", "92a4bf97"] },
    { name: "2 operands, CMYK [0], RealImaginary", colors: ["#20304040", "#40506080"], cmyk: [0], operation: "RealImaginary", expected: ["403a4040", "00000002"] },
    { name: "4 operands, CMYK [2], Add", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "Add", expected: ["695440cf", "7090c0b0"] },
    { name: "4 operands, CMYK [2], Subtract", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "Subtract", expected: ["000c4000", "10100050"] },
    { name: "4 operands, CMYK [2], Multiply", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "Multiply", expected: ["0000000c", "18171854"] },
    { name: "4 operands, CMYK [2], Divide", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "Divide", expected: ["b5ffffab", "690000ab"] },
    { name: "4 operands, CMYK [2], Conjugate", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "Conjugate", expected: ["20304040", "00000000"] },
    { name: "4 operands, CMYK [2], MagnitudePhase", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "MagnitudePhase", expected: ["485d738f", "aca9a7ac"] },
    { name: "4 operands, CMYK [2], RealImaginary", colors: ["#20304040", "#40506080", "#50607020", "#30406030"], cmyk: [2], operation: "RealImaginary", expected: ["00132e40", "00000001"] },
    { name: "2 operands, CMYK [0], Add opaque", colors: ["#203040", "#405060"], cmyk: [0], operation: "Add", expected: ["002040ff", "80a0c0ff"] },
    { name: "2 operands, CMYK [0, 1], Add", colors: ["#20304040", "#40506080"], cmyk: [0, 1], operation: "Add", expected: ["00000080", "000000ff"] },
    { name: "2 operands, CMYK [], Add", colors: ["#20304040", "#40506080"], cmyk: [], operation: "Add", expected: ["40608080", "80a0c0ff"] },
    { name: "2 operands, CMYK [], MagnitudePhase", colors: ["#20304040", "#40506080"], cmyk: [], operation: "MagnitudePhase", expected: ["485d738f", "aca9a7ac"] },
])(`${mode}, part ${part}: $name`, async ({ colors, cmyk, operation, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["-respect-parentheses", ...colors.flatMap((color, index) => ["(", `xc:${color}`,
        ...(cmyk.includes(index) ? ["-colorspace", "CMYK"] : []), ")"]),
        "-complex", operation, "-delete", String(1 - part), "+region", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected[part]);
});
