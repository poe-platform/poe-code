import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";


for (const mode of ["file", "stream", "sync"] as const) {
    it.each([
        { selector: "1-2", expected: "212223242526" },
        { selector: "1-3", expected: "212223242526313233343536" },
        { selector: "2-3", error: true },
        { selector: "1,2", error: true },
        { selector: "2,1", error: true },
        { selector: "0-1", expected: "010203040506111213141516", frames: 3 },
        { selector: "2,0", expected: "212223242526010203040506", frames: 3 },
        { selector: "2-2", expected: "212223242526" },
        { selector: "3-4", expected: "313233343536" },
        { selector: "1-9", expected: "212223242526313233343536" },
        { selector: "1,1", expected: "111213141516" },
        { selector: "3-1", error: true }
    ])(`matches native raw RGB decoded windows via ${mode}: $selector`, async ({ selector, expected, error, frames = 4 }) => {
        const bytes = Buffer.from("010203040506111213141516212223242526313233343536", "hex").subarray(0, frames * 6);
        const argv = ["-size", "2x1", "-depth", "8", `rgb:${mode === "stream" ? "-" : "raw.bin"}[${selector}]`, "rgb:-"];
        let stderr = "", stdout = "", exitCode: number;
        if (mode === "sync") {
            const result = runMagickCliSync(argv, new Map([["raw.bin", bytes]]));
            stderr = result.stderr;
            stdout = Buffer.from(result.stdoutBytes ?? []).toString("hex");
            if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout = Buffer.from(result.stdoutBytes).toString("hex");
            exitCode = result.exitCode;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/raw.bin", bytes);
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout = Buffer.from(result.stdoutBytes).toString("hex");
            exitCode = result.exitCode;
        }
        expect(exitCode).toBe(error ? 1 : 0);
        if (error) expect(stderr).toContain("invalid image index");
        else expect(stderr).toBe("");
        expect(stdout).toBe(expected ?? "");
    });
}
