import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI output, including spelling and order.
for (const [category, expected] of [
    ["AutoThreshold", "Kapur\nOTSU\nTriangle\n"],
    ["Metric", "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n"]
] as const) {
    for (const mode of ["command", "buffered", "retained", "sync"] as const) {
        it(`lists ${category} on stdout with no images (${mode})`, async () => {
            for (const name of [category, category.toLowerCase()]) {
                const argv = ["-list", name];
                const filesystem = new MemoryFileSystem();
                const files = new Map<string, Uint8Array>();
                let stdout = "", stderr = "";
                const command = createMagickCommand();
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? { ...await command.execute({
                    command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
            }
        });
    }
}
