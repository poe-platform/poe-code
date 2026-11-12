import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: disassociated alpha does not distinguish colors.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operations: ["-alpha", "disassociate", "-clamp"], expected: "1:1" },
        { operations: ["-alpha", "disassociate", "-depth", "1"], expected: "1:1" },
        { operations: ["-alpha", "disassociate", "-clamp", "-unique-colors"], expected: "1:1" },
        { operations: ["-alpha", "disassociate"], expected: "2:2" },
        { operations: ["-alpha", "disassociate", "-clamp", "-alpha", "activate"], expected: "2:2" },
    ])(`${mode}: counts colors after $operations`, async ({ operations, expected }) => {
        const argv = ["xc:#ffffffff", "xc:#8ab9cd80", "+append", ...operations, "-format", "%k:%[colors]", "info:"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
