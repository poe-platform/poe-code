import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: the first stop determines the colorspace.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { stops: "gray(20%)-red", options: ["-depth", "8"], output: "rgba", expected: "333333ff1a1a1aff000000ff" },
        { stops: "gray(20%)-red", options: ["-separate", "-format", "%n;"], output: "info", expected: "1;" },
        { stops: "gray(20%)-gray(70%)", options: ["-format", "%[colorspace]/%[channels]"], output: "info", expected: "Gray/gray  1.0" },
        { stops: "red-gray(20%)", options: ["-depth", "8"], output: "rgba", expected: "ff0000ff991a1aff333333ff" },
        { stops: "red-gray(20%)", options: ["-separate", "-format", "%n;"], output: "info", expected: "3;3;3;" },
    ])(`${mode}: gradient:$stops $options $output`, async ({ stops, options, output, expected }) => {
        const argv = ["-size", "3x1", `gradient:${stops}`, ...options, `${output}:-`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(stdout);
        expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
