import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { options: ["-median", "1"], warns: true },
        { options: ["-regard-warnings", "-median", "1"], warns: true },
        { options: ["-quiet", "-median", "1"], warns: false },
        { options: ["-quiet", "-regard-warnings", "-median", "1"], warns: false },
        { options: ["-quiet", "+quiet", "-median", "1"], warns: true },
        { options: ["-median", "1", "-quiet"], warns: true },
        { options: ["-statistic", "Median", "1x1"], warns: false },
    ])(`handles median warnings without changing status or pixels via ${mode}: $options`, async ({ options, warns }) => {
        const args = ["xc:red", ...options, "-depth", "8", "rgb:-"];
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        let stderr = "";
        const stdout: number[] = [];
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async bytes => { stdout.push(...bytes); } },
                stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
            }), stderr, stdoutBytes: Uint8Array.from(stdout)
        } : mode === "sync"
            ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(Array.from(result.stdoutBytes ?? [])).toEqual([255, 0, 0]);
        if (warns) {
            expect(result.stderr).toContain("option has been replaced '-median'");
            expect(result.stderr).toContain('use "-statistic Median"');
        } else {
            expect(result.stderr).toBe("");
        }
    });
}
