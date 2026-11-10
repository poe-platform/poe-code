import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 4x3 gray:- bytes in row order.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { radii: "2x1", expected: "ffb6b6ffbf4040bfffb6b6ff" },
        { radii: "2x1,1", expected: "ffb6b6ffbf4040bfffb6b6ff" },
        { radii: "2", expected: "ffb6b6ffbf4040bfffb6b6ff" },
        { radii: "2,1", expected: "ffffffffbf4040bfffffffff" },
    ])(`${mode}: reads gradient:radii=$radii`, async ({ radii, expected }) => {
        const argv = ["-size", "4x3", "-define", `gradient:radii=${radii}`, "radial-gradient:black-white", "-depth", "8", "gray:-"];
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
