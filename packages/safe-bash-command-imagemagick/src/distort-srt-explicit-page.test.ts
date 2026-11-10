import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: explicit SRT centers use virtual-page coordinates.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { page: "8x7+2+1", srt: "2,1,90", expected: "4x5|11x18-1+0" },
    { page: "8x7+2+1", srt: "2,1,1,90", expected: "4x5|11x18-1+0" },
    { page: "8x7+2+1", srt: "2,1,1,1,90", expected: "4x5|11x18-1+0" },
    { page: "8x7+2+1", srt: "2,1,1,90,2,1", expected: "4x5|11x18-1+0" },
    { page: "8x7+2+1", srt: "2,1,1,1,90,2,1", expected: "4x5|11x18-1+0" },
    { page: undefined, srt: "2,1,90", expected: "4x5|4x5+0-2" },
    { page: "8x7+2+1", srt: "0", expected: "5x4|13x14+1+0" },
])(`${mode}: best-fit SRT $srt on page $page`, async ({ page, srt, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-size", "3x2", "xc:red", ...(page ? ["-repage", page] : []),
        "-filter", "point", "-virtual-pixel", "tile", "+distort", "SRT", srt,
        "-format", "%wx%h|%g", "info:-"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
});
