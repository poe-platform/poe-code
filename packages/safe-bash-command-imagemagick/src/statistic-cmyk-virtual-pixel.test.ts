import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for a 1x1 CMYK image.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { virtualPixel: "white", statistic: "Mean", channel: "K", depth: "8", expected: "ed" },
    { virtualPixel: "white", statistic: "Minimum", channel: "K", depth: "8", expected: "5f" },
    { virtualPixel: "gray", statistic: "Maximum", channel: "K", depth: "8", expected: "80" },
    { virtualPixel: "gray", statistic: "Maximum", channel: "K", depth: "16", expected: "8000" },
    { virtualPixel: "white", statistic: "Mean", channel: "C", depth: "8", expected: "e3" },
    { virtualPixel: "black", statistic: "Mean", channel: "K", depth: "8", expected: "0b" },
    { virtualPixel: "edge", statistic: "Mean", channel: "K", depth: "8", expected: "5f" }
])(`${mode}: $statistic of CMYK $channel with $virtualPixel virtual pixels at depth $depth`, async ({ virtualPixel, statistic, channel, depth, expected }) => {
    const argv = ["xc:#a06030c0", "-colorspace", "CMYK", "-virtual-pixel", virtualPixel,
        "-statistic", statistic, "3x3", "-channel", channel, "-separate", "+channel",
        "-depth", depth, "-endian", "MSB", "gray:-"];
    const fs = new MemoryFileSystem(), output: Uint8Array[] = [];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, new Map())
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(output) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(bytes.toString("hex")).toBe(expected);
});
