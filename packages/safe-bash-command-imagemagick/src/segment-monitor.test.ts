import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { before: [], after: [], progress: false },
        { before: ["-monitor"], after: [], progress: true },
        { before: ["-monitor", "+monitor"], after: [], progress: false },
        { before: ["+monitor", "-monitor", "-regard-warnings"], after: [], progress: true },
        { before: ["-monitor"], after: ["+monitor"], progress: true },
        { before: [], after: ["-monitor"], progress: false }
    ])(`${mode}: segment monitoring before=$before after=$after`, async ({ before, after, progress }) => {
        const fs = new MemoryFileSystem();
        const args = ["-size", "32x32", "xc:red", "xc:lime", "xc:blue", "+append",
            ...before, "-segment", "1x1", ...after, "-format", "COLORS=%k", "info:"];
        let result;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("COLORS=3");
        if (progress) {
            expect(result.stderr).toContain("segment image[");
            expect(result.stderr).toContain("100% complete");
        } else expect(result.stderr).toBe("");
    });
}

for (const retained of [false, true]) {
    it(`preserves segment failures with monitoring (retained=${retained})`, async () => {
        const input = () => retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        const args = ["xc:red", "-segment", "invalid", "info:"];
        const baseline = await runMagickCli(args, input());
        expect(baseline.exitCode).not.toBe(0);
        expect(await runMagickCli(["-monitor", ...args], input())).toEqual(baseline);
    });
}
