import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { name: "single row", input: ["xc:red", "xc:blue", "xc:red", "+append"], output: "1x2+1+0|1,0 2,2|3x1", warning: false },
        { name: "single column", input: ["xc:red", "xc:blue", "xc:red", "-append"], output: "2x1+0+1|0,1 2,2|1x3", warning: false },
        { name: "solid row", input: ["-size", "3x1", "xc:red"], format: "%@", output: "0x1+3+1", warning: true },
        { name: "solid column", input: ["-size", "1x3", "xc:red"], format: "%@", output: "1x0+1+3", warning: true },
        { name: "solid row bounding box", input: ["-size", "3x1", "xc:red"], format: "%[bounding-box]", output: "3,1 3,2", warning: true },
        { name: "solid column bounding box", input: ["-size", "1x3", "xc:red"], format: "%[bounding-box]", output: "1,3 2,3", warning: true },
        { name: "single pixel", input: ["xc:red"], output: "1x1+1+1|1,1 2,2|1x1", warning: false },
        { name: "two-dimensional control", input: ["-size", "3x3", "xc:white", "-fill", "red", "-draw", "point 1,1"], output: "1x1+1+1|1,1 2,2|3x3", warning: false },
        { name: "cropped row", input: ["xc:red", "xc:blue", "xc:red", "+append", "-trim"], output: "1x1+1+1|1,1 2,2|1x1", warning: false },
        { name: "cropped column", input: ["xc:red", "xc:blue", "xc:red", "-append", "-trim"], output: "1x1+1+1|1,1 2,2|1x1", warning: false }
    ])(`${mode} formats native bounds for $name`, async ({ input, output, warning, format = "%@|%[bounding-box]|%wx%h" }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = [...input, "-format", format, "info:/out"];
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
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: warning ? "magick: geometry does not contain image\n" : "" });
        const written = mode === "map" || mode === "sync" ? files.get("/out") : await fs.readFile("/out");
        expect(new TextDecoder().decode(written)).toBe(output);
    });
}
