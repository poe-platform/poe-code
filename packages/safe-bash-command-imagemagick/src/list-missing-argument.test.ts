import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["-list"], exitCode: 1, stdout: expect.stringContaining("Usage: magick"), stderr: "magick: invalid argument for option '-list'\n" },
        { args: ["-list", "Metric"], exitCode: 0, stdout: "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n", stderr: "" },
        { args: ["-list", "List"], exitCode: 0, stdout: "color\nconfigure\ndelegate\nfont\nformat\nlocale\nlog\nmagic\nmodule\nresource\nthreshold\ntype\n", stderr: "" }
    ])(`${mode}: requires an explicit list category: $args`, async ({ args, ...expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = { exitCode: result.exitCode, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr };
        expect(output).toEqual(expected);
        if (expected.exitCode) expect(output.stdout).toContain("Version: ImageMagick");
        expect(files.size).toBe(0);
        expect(await fs.readdir("/")).toEqual([]);
    });
}
