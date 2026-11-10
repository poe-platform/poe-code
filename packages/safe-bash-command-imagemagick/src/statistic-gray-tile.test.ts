import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { virtualPixel: "horizontal-tile", background: "#27b49360", expected: "85858580" },
    { virtualPixel: "vertical-tile", background: "#27b49360", expected: "85858580" },
    { virtualPixel: "checker-tile", background: "#27b49360", expected: "7c7c7c95" },
    { virtualPixel: "edge", background: "#27b49360", expected: "6a6a6ac0" },
    { virtualPixel: "background", background: "#27b49360", expected: "2eac8e6b" },
    { virtualPixel: "horizontal-tile", background: "#93939360", expected: "85858580" },
])(`${mode}: Gray Mean with $virtualPixel and $background`, async ({ virtualPixel, background, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:#a06030c0", "-colorspace", "Gray", "-background", background,
        "-virtual-pixel", virtualPixel, "-statistic", "Mean", "3x3", "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
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
