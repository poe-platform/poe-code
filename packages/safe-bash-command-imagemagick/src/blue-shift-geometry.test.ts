import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete 8-bit RGBA stdout for xc:#4080a080.
for (const mode of ["buffered", "sync", "retained", "command"] as const)
it.each([
    { factor: "1.5", expected: "a0b0b880", exitCode: 0 },
    { factor: "1.5%", expected: "a0b0b880", exitCode: 0 },
    { factor: "1.5x2", expected: "a0b0b880", exitCode: 0 },
    { factor: "(1.5)", expected: "a0b0b880", exitCode: 0 },
    { factor: "bad", expected: "", exitCode: 1 },
    { factor: "1.5+1", expected: "", exitCode: 1, input: "xc:#345caa80" },
    { factor: "1.5-1", expected: "", exitCode: 1, input: "xc:#345caa80" },
    { factor: "2+1", expected: "", exitCode: 1, input: "xc:#345caa80" },
    { factor: "2x3+1+1", expected: "d1dbef80", exitCode: 0, input: "xc:#345caa80" },
    { factor: "1.5", expected: "a0aabe80", exitCode: 0, input: "xc:#345caa80" },
    { factor: "0", expected: "10202880", exitCode: 0, options: ["-set", "option:shift", "1.5"] },
    { factor: "2", expected: "d0e0e880", exitCode: 0, options: ["-set", "option:shift", "1.5"] },
    { factor: "0x2", expected: "10202880", exitCode: 0, options: ["-set", "option:shift", "1.5"] },
])(`reads the leading blue-shift geometry factor $factor (${mode})`, async ({ factor, expected, exitCode, options, input }) => {
    const args = [...(options ?? []), input ?? "xc:#4080a080", "-blue-shift", factor, "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(exitCode);
    if (exitCode) expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument");
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});
