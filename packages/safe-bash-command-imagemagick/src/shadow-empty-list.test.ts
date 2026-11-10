import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects an empty current list before opening output.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        ["before input", ["-shadow", "80x0+1+2", "-size", "3x2", "xc:#5080c080"], false],
        ["empty group", ["-size", "3x2", "xc:#5080c080", "(", "-shadow", "80x0+1+2", ")"], false],
        ["after input", ["-size", "3x2", "xc:#5080c080", "-background", "#d04020", "-shadow", "80x0+1+2"], true],
    ] as const)(`${mode}: shadow %s matches native status and output`, async (_placement, operation, valid) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const args = [...operation, "-format", "%wx%h %g %[channels];", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out") : await fs.readFile("/out");
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe(valid ? "" : "magick: no images found for operation '-shadow'\n");
        expect.soft(output).toEqual(valid ? new TextEncoder().encode("3x2 4x4+1+2 srgba 4.0;") : original);
    });
}
