import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, five combined planes with a nonconstant Meta0.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "selected Meta0", operations: ["-channel", "Meta0", "-unsharp", "1x1+1+0"], output: "Meta0", expected: "0589d2" },
        { name: "unmodified Meta0", operations: [], output: "Meta0", expected: "2080c0" },
        { name: "red selection preserves Meta0", operations: ["-channel", "R", "-unsharp", "1x1+1+0"], output: "Meta0", expected: "2080c0" },
        { name: "Meta0 selection preserves red", operations: ["-channel", "Meta0", "-unsharp", "1x1+1+0"], output: "R", expected: "404040" },
    ])(`${mode}: unsharp $name`, async ({ operations, output, expected }) => {
        const argv = ["-size", "3x1", "xc:#404040", "-duplicate", "3", "(", "+size",
            "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine", ...operations,
            "+channel", "-channel", output, "-separate", "+channel", "-depth", "8", "gray:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
        expect(hex).toBe(expected);
    });
}
