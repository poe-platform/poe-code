import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a colon makes the first pair a ratio;
// the third field supplies the x offset while omitted y stays at four.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["80x2:3", "8x8+1+2"],
        ["80:2:3", "8x8+1+2"],
        ["80x2:5", "10x8+3+2"],
        ["80:2:5", "10x8+3+2"],
        ["80X2:3", "8x8+1+2"],
        ["80x0x2:3", "8x8+1+2"],
        ["80,2:3", "8x8+1+2"],
        ["80/2:3", "8x8+1+2"],
        ["80x2:3e+0", "8x8+1+2"],
        ["80x2:-3", "2x8-5+2"],
        ["80x2:3+4", "8x8+1+2"],
        ["80:2:3:4", "8x8+1+2"],
        ["80x2+3:4", "8x8+1+2"],
        ["80:2+1+2", "6x6-1+0"],
        ["40x1+3+4", "8x8+1+2"],
        ["40x1+5+4", "10x8+3+2"],
    ])(`preserves ratio shadow opacity and third-field offsets for %s (${mode})`, async (geometry, page) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "3x2", "xc:#507ba080", "-background", "#d05028", "-shadow", geometry!,
            "-format", "%wx%h %g %[fx:p{2,2}.a]", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stdout" in result) {
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(`7x6 ${page} 0.086312`);
    });
}
