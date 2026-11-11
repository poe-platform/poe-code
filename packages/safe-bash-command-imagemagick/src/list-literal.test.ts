import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const metrics = "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["xc:red", "-format", "-list", "info:"], stdout: "-list" },
        { args: ["xc:red", "-print", "-list", "null:"], stdout: "-list" },
        { args: ["xc:red", "-format", "list", "info:"], stdout: "list" },
        { args: ["xc:red", "-format", "saved", "-print", "-list", "info:"], stdout: "-listsaved" },
        { args: ["-size", "2x1", "xc:red", "-print", "%wx%h;", "-resize", "1x1!", "-print", "%wx%h;", "null:"], stdout: "2x1;1x1;" },
        { args: ["xc:red", "xc:blue", "-print", "%n:%w", "null:"], stdout: "2:1" },
        { args: ["identify", "-format", "-list", "xc:red"], stdout: "-list" },
        { args: ["identify", "--format", "-list", "xc:red"], stdout: "-list" },
        { args: ["xc:red", "-print", "list", "null:"], stdout: "list" },
        { args: ["-list", "Metric"], stdout: metrics },
        { args: ["identify", "-format", "-format", "-list", "Metric"], stdout: metrics },
        { args: ["identify", "-format", "--", "-list", "Metric"], stdout: metrics }
    ])(`${mode} respects option argument positions: $args`, async ({ args, stdout }) => {
        const fs = new MemoryFileSystem();
        const expected = { exitCode: 0, stdout, stderr: "" };
        if (mode === "command") {
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ exitCode: result.exitCode, stdout, stderr }).toEqual(expected);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
            expect(result).toEqual(expected);
        }
    });
}
