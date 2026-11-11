import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { options: [], progress: false },
        { options: ["-monitor"], progress: true },
        { options: ["+monitor"], progress: false },
        { options: ["-monitor", "+monitor"], progress: false },
        { options: ["+monitor", "-monitor", "-regard-warnings"], progress: true }
    ])(`${mode}: resize monitoring $options`, async ({ options, progress }) => {
        const fs = new MemoryFileSystem();
        const args = [...options, "-size", "16x16", "xc:red", "-resize", "8x8", "-format", "%wx%h", "info:"];
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
        expect(result.stdout).toBe("8x8");
        if (progress) {
            expect(result.stderr).toContain("resize image[red]");
            expect(result.stderr).toContain("100%");
        } else expect(result.stderr).toBe("");
    });
}

for (const retained of [false, true]) {
    it(`applies monitor switches in operation order (retained=${retained})`, async () => {
        const result = await runMagickCli([
            "-monitor", "-size", "16x16", "xc:red", "-resize", "8x8",
            "+monitor", "xc:blue", "-resize", "4x4", "-format", "%wx%h ", "info:"
        ], retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("4x4 4x4 ");
        expect(result.stderr).toContain("resize image[red]");
        expect(result.stderr).not.toContain("resize image[blue]");
    });

    it(`preserves resize failures with monitoring (retained=${retained})`, async () => {
        const input = () => retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        const args = ["xc:red", "-resize", "invalid", "info:"];
        const baseline = await runMagickCli(args, input());
        expect(baseline.exitCode).not.toBe(0);
        expect(await runMagickCli(["-monitor", ...args], input())).toEqual(baseline);
    });
}
