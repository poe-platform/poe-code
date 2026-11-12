import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA pixels from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    for (const reverse of [false, true])
    it.each([
        { operation: "Subtract", expected: ["000010c0", "00009070"] },
        { operation: "And", expected: ["40000000", "25209070"] },
        { operation: "Or", expected: ["597910c0", "30669070"] },
        { operation: "Xor", expected: ["197910c0", "0b459070"] },
        { operation: "Min", expected: ["40200000", "26269070"] },
        { operation: "Add", expected: ["997910c0", "55869070"] },
        { operation: "Divide", expected: ["000010c0", "00009070"] },
        { operation: "Threshold", expected: ["0000ffff", "00009070"] },
        { operation: "ThresholdBlack", expected: ["000010c0", "00009070"] },
        { operation: "ThresholdWhite", expected: ["4020ffff", "26269070"] },
        { operation: "RMS", expected: ["2d6f16b80b5c884b", "1aba1abb00880078"], depth: 16 },
        { operation: "RootMeanSquare", expected: ["2d6f16b80b5c884b", "1aba1abb00880078"], depth: 16 },
        { operation: "Sum", expected: ["997910c0", "55869070"] },
        { operation: "Max", expected: ["595910c0", "2f609070"] },
    ])(`${mode}: $operation uses GrayAlpha channel contributions (reverse=${reverse})`, async ({ operation, expected, depth = 8 }) => {
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = ["(", "xc:#2f609070", "-colorspace", reverse ? "sRGB" : "Gray", ")",
            "(", "xc:#402010c0", "-colorspace", reverse ? "Gray" : "sRGB", ")",
            ...(depth === 16 ? ["-channel", "RGBA"] : []), "-evaluate-sequence", operation,
            ...(depth === 16 ? ["+channel"] : []), "-colorspace", "sRGB",
            "-depth", String(depth), "-endian", "MSB", "rgba:-"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected[Number(reverse)]);
    });
}
