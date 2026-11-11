import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { name: "first image units", input: ["xc:red", "-set", "units", "PixelsPerInch", "xc:blue"], units: "PixelsPerInch", density: "72,72" },
            { name: "first image centimeter units", input: ["xc:red", "-set", "units", "PixelsPerCentimeter", "xc:blue"], units: "PixelsPerCentimeter", density: "28.346456692913385,28.346456692913385" },
            { name: "different second image units", input: ["xc:red", "-set", "units", "PixelsPerInch", "(", "xc:blue", "-set", "units", "PixelsPerCentimeter", ")"], units: "PixelsPerInch", density: "72,72" },
            { name: "only second image units", input: ["xc:red", "(", "xc:blue", "-set", "units", "PixelsPerInch", ")"], units: "Undefined", density: "72,72" },
            { name: "single image units", input: ["xc:red", "-set", "units", "PixelsPerInch"], units: "PixelsPerInch", density: "72,72" },
            { name: "persistent units option", input: ["xc:red", "-units", "PixelsPerInch", "xc:blue"], units: "PixelsPerInch", density: "72,72" },
            { name: "explicit resolution", input: ["xc:red", "-density", "144x90", "-set", "units", "PixelsPerInch", "xc:blue"], units: "PixelsPerInch", density: "144,90" },
        ])(`${mode} ${operation}: preserves $name`, async ({ input, units, density }) => {
            const argv = [...input, operation, "0", "-format", "%U|%[units]|%x,%y", "info:"];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe(`${units}|${units}|${density}`);
        });
    }
}
