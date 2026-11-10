import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw big-endian RGBA16.
const cases: { space: string; statistic?: string; hex: string; size?: string; channel?: string }[] = [
    { space: "Lab", statistic: "Mean", hex: "85a36fc5a22655aba1c076eb862b8080b7a97ec4695aab55" },
    { space: "HSL", statistic: "Mean", hex: "20053f78cb9055ab3ecd24f0d15a80807da52ad5d62bab55" },
    { space: "HSL", statistic: "Maximum", hex: "93c62020e0e08080e0e020206d3ac0c0e0e020206d3ac0c0" },
    { space: "Lab", hex: "80832019c0bf40402022e0e0504e8080d0d33021706ec0c0" },
    { space: "HSL", hex: "80802020c0c040402020e0e050508080d0d030307070c0c0" },
    { space: "sRGB", statistic: "Mean", hex: "606060609b4555ab7b2565bb8080808095eb6b1565bbab55" },
];

// Alpha-only filtering must preserve working colors across storage and output chunks.
for (const space of ["Lab", "HSL"]) {
    const rgb = space === "Lab" ? ["80832019c0bf", "2022e0e0504e", "d0d33021706e"]
        : ["80802020c0c0", "2020e0e05050", "d0d030307070"];
    for (const statistic of ["Mean", "Maximum"]) cases.push({
        space, statistic, size: "513x1", channel: "A",
        hex: (rgb[0] + "4040").repeat(512) + rgb[0] + (statistic === "Mean" ? "55ab" : "8080")
            + rgb[1] + (statistic === "Mean" ? "6b15" : "8080") + (rgb[1] + "8080").repeat(511)
            + rgb[1] + (statistic === "Mean" ? "95eb" : "c0c0")
            + rgb[2] + (statistic === "Mean" ? "ab55" : "c0c0") + (rgb[2] + "c0c0").repeat(512),
    });
}

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: converts $space $statistic samples back to sRGB (size=$size, channel=$channel)`, async ({ space, statistic, hex, size, channel }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = [...(size ? ["-size", size] : []), "xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-colorspace", space,
        ...(channel ? ["-channel", channel] : []), ...(statistic ? ["-statistic", statistic, "3x1"] : []), "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
