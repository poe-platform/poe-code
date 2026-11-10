import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    for (const trim of [false, true]) {
        it.each([
            { name: "percentage ignores a border speck", options: ["-fill", "black", "-draw", "point 0,2", "-define", "trim:percent-background=20%"], bounds: "2x2+2+1|2,1 4,3;", crop: "2x2 6x5+2+1;" },
            { name: "explicit percentage background", options: ["-define", "trim:percent-background=50%", "-define", "trim:background-color=red"], bounds: "6x5+0+0|0,0 6,5;", crop: "6x5 6x5+0+0;" },
            { name: "reset percentage", options: ["-fill", "black", "-draw", "point 0,2", "-define", "trim:percent-background=20%", "+define", "trim:percent-background"], bounds: "4x2+0+1|0,1 4,3;", crop: "4x2 6x5+0+1;" },
            { name: "reset background", options: ["-define", "trim:percent-background=50%", "-define", "trim:background-color=red", "+define", "trim:background-color"], bounds: "2x2+2+1|2,1 4,3;", crop: "2x2 6x5+2+1;" }
        ])(`${mode} reports $name (trim=${trim})`, async ({ options, bounds, crop }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const args = ["-size", "6x5", "xc:white", "-fill", "red", "-draw", "rectangle 2,1 3,2", ...options,
                ...(trim ? ["-trim"] : []), "-format", trim ? "%wx%h %g;" : "%@|%[bounding-box];", "info:/out"];
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
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "map" || mode === "sync" ? files.get("/out") : await fs.readFile("/out");
            expect(new TextDecoder().decode(output)).toBe(trim ? crop : bounds);
        });
    }
}
