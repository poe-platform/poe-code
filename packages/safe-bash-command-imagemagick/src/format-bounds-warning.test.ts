import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    for (const target of ["info:/out", "info:-"]) {
        it.each([
            { options: ["-regard-warnings"], format: "%@", draw: false, output: "0x0+6+5", exitCode: 1 },
            { options: ["-regard-warnings"], format: "%[bounding-box]", draw: false, output: "6,5 6,5", exitCode: 1 },
            { options: [], format: "%@", draw: false, output: "0x0+6+5", exitCode: 0 },
            { options: [], format: "%[bounding-box]", draw: false, output: "6,5 6,5", exitCode: 0 },
            { options: ["-regard-warnings", "+regard-warnings"], format: "%@", draw: false, output: "0x0+6+5", exitCode: 0 },
            { options: ["-regard-warnings", "+regard-warnings"], format: "%[bounding-box]", draw: false, output: "6,5 6,5", exitCode: 0 },
            { options: ["-regard-warnings"], format: "%@|%[bounding-box];", draw: true, output: "2x2+2+1|2,1 4,3;", exitCode: 0 }
        ])(`${mode} ${target}: $options $format (draw=$draw)`, async ({ options, format, draw, output, exitCode }) => {
            const keep = new TextEncoder().encode("KEEP"), files = new Map([["/out", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const args = [...options, "-size", "6x5", "xc:white", ...(draw ? ["-fill", "red", "-draw", "rectangle 2,1 3,2"] : []), "-format", format, target];
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
            expect(result).toEqual({ exitCode, stdout: target === "info:-" ? output : "", stderr: draw ? "" : "magick: geometry does not contain image\n" });
            const written = mode === "map" || mode === "sync" ? files.get("/out") : await fs.readFile("/out");
            expect(new TextDecoder().decode(written)).toBe(target === "info:-" ? "KEEP" : output);
        });
    }
}
