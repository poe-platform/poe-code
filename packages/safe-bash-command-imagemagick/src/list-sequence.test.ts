import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const metrics = "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { args: ["xc:red", "-depth", "8", "-write", "rgb:pixels", "-list", "Metric", "-format", "OK", "info:"], stdout: metrics + "OK", write: true, code: 0 },
        { args: ["xc:red", "-list", "NotAList", "info:"], stdout: "", write: false, code: 1 },
        { args: ["-madeup", "-list", "Metric"], stdout: "", write: false, code: 11 },
        { args: ["-list", "Metric"], stdout: metrics, write: false, code: 0 },
        { args: ["xc:red", "-format", "BEFORE", "-write", "info:", "-list", "Metric", "-list", "Metric", "-format", "AFTER", "info:"], stdout: "BEFORE" + metrics + metrics + "AFTER", write: false, code: 0 },
        { args: ["xc:red", "-set", "label", "-list", "-format", "%[label]", "info:"], stdout: "-list", write: false, code: 0 }
    ])(`${mode}: executes list in order: $args`, async ({ args, stdout: expected, write, code }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
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
        } else result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(code);
        expect(result.stdout).toBe(expected);
        if (code) expect(result.stderr).toContain(code === 11 ? "unrecognized option '-madeup'" : "unrecognized list type");
        else expect(result.stderr).toBe("");
        if (write) expect(Array.from(mode === "sync" || mode === "map" ? files.get("pixels")! : await fs.readFile("/pixels"))).toEqual([255, 0, 0]);
    });
}
