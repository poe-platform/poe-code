import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian 16-bit gray output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { statistic: "Mean", extract: false, expected: "000000000000" },
        { statistic: "Gradient", extract: false, expected: "000000000000" },
        { statistic: "", extract: false, expected: "40408080c0c0" },
        { statistic: "Mean", extract: true, expected: "ffffffffffff" },
    ])(`${mode}: reads disassociated alpha after $statistic (extract=$extract)`, async ({ statistic, extract, expected }) => {
        const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", "-alpha", "disassociate",
            ...(statistic ? ["-statistic", statistic, "3x1"] : []),
            ...(extract ? ["-alpha", "extract"] : ["-channel", "A", "-separate", "+channel"]),
            "-depth", "16", "-endian", "MSB", "gray:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv), stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
