import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA bytes.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["25x50+75", 0, "60706480"],
        ["25,50,75", 0, "60706480"],
        ["2.5e+1x5e1+75", 0, "60706480"],
        ["25x50-75", 0, "6070dc80"],
        ["(50)", 0, "80707880"],
        ["50!", 0, "80707880"],
        ["50", 0, "80707880"],
        ["bogus", 1, ""],
        ["50bogus", 1, ""],
    ] as const)(`${mode}: colorize geometry %s`, async (strength, exitCode, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#4080a080", "-fill", "#bf605040", "-colorize", strength,
            "-depth", "8", `rgba:${mode === "command" ? "-" : "/out"}`];
        const stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(exitCode);
        if (exitCode !== 0) {
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument");
            expect(stdout).toEqual([]);
            expect(files.size).toBe(0);
            await expect(fs.readFile("/out")).rejects.toThrow();
            return;
        }
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? stdout : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
