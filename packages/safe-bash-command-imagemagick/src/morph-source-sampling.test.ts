import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGB8 output of the middle frame.
const cases = [
    { name: "same-size red selection", width: 5, second: ["-channel", "R"], expected: "000000000080800000000000000000" },
    { name: "same-size full region", width: 5, region: true, expected: "000000000080800000000000000000" },
    { name: "unequal-size red selection", width: 9, second: ["-channel", "R"], expected: "000000000000000080630000000000000000000000" },
    { name: "unequal-size full region", width: 9, region: true, expected: "000000000000000080630000000000000000000000" },
    { name: "same-size Gaussian selection", width: 5, second: ["-channel", "R"], filter: "Gaussian", expected: "0000000e00806400000e0000000000" },
    { name: "unequal-size Gaussian selection", width: 9, second: ["-channel", "R"], filter: "Gaussian", expected: "0000000000000b00804f00000b0000000000000000" },
    { name: "same-size unselected control", width: 5, second: [], expected: "000000000000800080000000000000" },
    { name: "unequal-size unselected control", width: 9, second: [], expected: "00000300000000002a63008000002a000000000003" },
    { name: "Point selection control", width: 5, second: ["-channel", "R"], filter: "Point", expected: "000000000000800080000000000000" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const vertical of [false, true])
it.each(cases)(`${mode}, vertical=${vertical}: morph resamples the second source with $name`, async ({ width, second = [], region = false, expected, filter = "Lanczos" }) => {
    const argv = [
        "-respect-parentheses",
        "(", "-size", vertical ? `1x${width}` : `${width}x1`, "xc:black", "-fill", "red", "-draw", vertical ? `point 0,${Math.floor(width / 2)}` : `point ${Math.floor(width / 2)},0`, "-filter", filter, ")",
        "(", "-size", vertical ? "1x5" : "5x1", "xc:black", "-fill", "blue", "-draw", vertical ? "point 0,2" : "point 2,0", "-filter", filter, ...second, ...(region ? ["-region", vertical ? "1x5+0+0" : "5x1+0+0"] : []), ")",
        "-morph", "1", "-delete", "0,2", "+channel", "+region", "-depth", "8", "rgb:-",
    ];
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
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
