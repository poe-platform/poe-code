import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian RGBA stdout.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["#28f62a003000ffff", "+0x10.8%", "28f62a00cfffffff"],
        ["#100020003000ffff", "+0x10.8%", "10002000cfffffff"],
        ["#28f62a003000ffff", "16.5%", "28f62a00cfffffff"],
        ["#28f62a003000ffff", "0x10.8%", "d709d5ffcfffffff"],
        ["#28f62a003000ffff", "+0x10%", "d709d5ffcfffffff"],
    ] as const)(`${mode}: solarizes %s at %s`, async (color, threshold, expected) => {
        const argv = [`xc:${color}`, "-channel", "RGB", "-solarize", threshold, "+channel", "-depth", "16", "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
    });
}
