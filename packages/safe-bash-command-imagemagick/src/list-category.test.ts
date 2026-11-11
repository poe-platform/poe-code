import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { category: "NotAListName", exitCode: 1, stdout: "", stderr: "magick: unrecognized list type '-list' 'NotAListName'\n" },
        { category: "Metric", exitCode: 0, stdout: "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n", stderr: "" },
        { category: "List", exitCode: 0, stdout: "color\nconfigure\ndelegate\nfont\nformat\nlocale\nlog\nmagic\nmodule\nresource\nthreshold\ntype\n", stderr: "" }
    ])(`${mode} handles -list $category without image input`, async ({ category, ...expected }) => {
        const args = ["-list", category];
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        if (mode === "command") {
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            expect({ exitCode: result.exitCode, stdout, stderr }).toEqual(expected);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual(expected);
        }
        expect(files.size).toBe(0);
        expect(await filesystem.readdir("/")).toEqual([]);
    });
}
