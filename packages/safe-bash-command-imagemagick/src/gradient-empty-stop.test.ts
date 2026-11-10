import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI distinguishes empty and omitted stops.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "white", stops: "red-", expected: "ff0000ffffffffff" },
        { background: "lime", stops: "red-", expected: "ff0000ffffffffff" },
        { background: "white", stops: "red", expected: "ff0000ff000000ff" },
        { background: "lime", stops: "red-white", expected: "ff0000ffffffffff" },
    ])(`${mode}: gradient:$stops with $background background`, async ({ background, stops, expected }) => {
        const argv = ["-size", "2x1", "-background", background, `gradient:${stops}`, "-depth", "8", "rgba:-"];
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
        const bytes = "stdout" in result ? Buffer.from(result.stdoutBytes ?? result.stdout) : Buffer.concat(stdout);
        expect(bytes.toString("hex")).toBe(expected);
    });
}
