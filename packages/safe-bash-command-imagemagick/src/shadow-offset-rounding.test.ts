import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rounds exact half-pixel shadow offsets down.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["+0.5+1.5", "3x3+0+1"],
        ["-0.5-1.5", "2x0-1-2"],
        ["+0.4999+1.4999", "3x3+0+1"],
        ["+0.5001+1.5001", "4x4+1+2"],
        ["-0.4999-1.4999", "3x1+0-1"],
        ["-0.5001-1.5001", "2x0-1-2"],
        ["+0+1", "3x3+0+1"],
        ["-1-2", "2x0-1-2"],
    ])(`rounds shadow offsets %s with native geometry and alpha (${mode})`, async (offset, page) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "3x2", "xc:#507ba080", "-background", "#d05028", "-shadow", `80x0${offset}`,
            "-format", "%wx%h %g %[fx:p{0,0}.a]", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(`3x2 ${page} 0.401569`);
    });
}
