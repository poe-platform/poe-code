import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including independent alpha.
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    { statistic: "Mean", separate: true, expected: "348a2f2f29d4" },
    { statistic: "Maximum", separate: true, expected: "3f3f3f3f2f2f" },
    { statistic: "Mean", separate: false, expected: "641d5a6d9fdc55ab7df3614483f1808098fa68566660ab55" },
    { statistic: "", separate: true, expected: "3f3f1f1f2f2f" },
    { statistic: "", separate: false, expected: "80802020c0c040402020e0e050508080d0d030307070c0c0" }
])(`${mode}: CMYK $statistic (separate black=$separate)`, async ({ statistic, separate, expected }) => {
    const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-colorspace", "CMYK",
        ...(statistic ? ["-statistic", statistic, "3x1"] : []),
        ...(separate ? ["-channel", "K", "-separate", "+channel"] : ["-colorspace", "sRGB"]),
        "-depth", "16", "-endian", "MSB", separate ? "gray:-" : "rgba:-"];
    const argumentValues = createCommandArguments(argv), output: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs: new MemoryFileSystem(), cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, new Map()) : await runConvertCli(argv, new Map());
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(output) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(bytes.toString("hex")).toBe(expected);
});

for (const statistic of ["Minimum", "Maximum", "Mean", "Median", "Mode", "NonPeak", "RMS", "StandardDeviation", "Contrast", "Gradient", "Undefined"])
for (const channel of ["K", "A"])
it(`applies ${statistic} independently to CMYK ${channel}`, async () => {
    const input = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-colorspace", "CMYK"];
    const separate = ["-channel", channel, "-separate", "+channel"];
    const operation = ["-statistic", statistic, "3x1"];
    const results: string[] = [];
    for (const order of [
        [...input, "-channel", channel, ...operation, "+channel", ...separate],
        [...input, ...separate, ...operation]
    ]) {
        const argumentValues = createCommandArguments([...order, "-depth", "16", "-endian", "MSB", "gray:-"]);
        const output: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: new MemoryFileSystem(), cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
        results.push(Buffer.concat(output).toString("hex"));
    }
    expect(results[0]).toBe(results[1]);
});

it.each([
    { selection: "K", separate: "A", expected: "40408080c0c0" },
    { selection: "A", separate: "K", expected: "3f3f1f1f2f2f" },
    { selection: "R", separate: "K", expected: "3f3f1f1f2f2f" }
])("preserves CMYK $separate when only $selection is selected", async ({ selection, separate, expected }) => {
    const argumentValues = createCommandArguments([
        "xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-colorspace", "CMYK",
        "-channel", selection, "-statistic", "Mean", "3x1", "+channel",
        "-channel", separate, "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:-"
    ]);
    const output: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs: new MemoryFileSystem(), cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(output).toString("hex")).toBe(expected);
});
