import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw big-endian gray16.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { geometry: "(3x1)", expected: "55ab8080ab55" },
    { geometry: "3x1", expected: "55ab8080ab55" },
    { geometry: "(1x1)", expected: "40408080c0c0" },
    { geometry: "1x1", expected: "40408080c0c0" },
])(`${mode}: reads parenthesized statistic geometry $geometry`, async ({ geometry, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append",
        "-statistic", "Mean", geometry, "-depth", "16", "-endian", "MSB", "gray:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
