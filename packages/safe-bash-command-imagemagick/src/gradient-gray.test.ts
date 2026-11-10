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
        let bytes: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
