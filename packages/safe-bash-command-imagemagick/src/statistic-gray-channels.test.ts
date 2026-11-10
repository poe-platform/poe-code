import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, after conversion back to sRGB.
const unchanged = "22222280888888c022222280";
const cases = ["Gray", "LinearGray"].flatMap(space => [
    { space, channel: "R", statistic: "Maximum", expected: "88888880888888c088888880" },
    { space, channel: "R", statistic: "Median", expected: "22222280222222c022222280" },
    ...["G", "B"].flatMap(channel => ["Maximum", "Median"].map(statistic => ({ space, channel, statistic, expected: unchanged }))),
    { space, channel: "A", statistic: "Median", expected: "222222808888888022222280" },
    { space, channel: "", statistic: "Maximum", expected: "888888c0888888c0888888c0" },
]);
cases.push({ space: "sRGB", channel: "R", statistic: "Maximum", expected: "88222280888888c088222280" });

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: $space $channel $statistic respects logical gray channels`, async ({ space, channel, statistic, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:#22222280", "xc:#888888c0", "xc:#22222280", "+append", "-colorspace", space,
        ...(channel ? ["-channel", channel] : []), "-statistic", statistic, "3x1", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
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
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
