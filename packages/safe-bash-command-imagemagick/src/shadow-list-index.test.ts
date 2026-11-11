import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { geometry: "60x1+%[fx:t]+1", expected: "7x6 5x5-2-1;7x6 6x5-1-1;" },
        { geometry: "60x1+1+%[fx:t]", expected: "7x6 6x4-1-2;7x6 6x5-1-1;" },
        { geometry: "60x1+0+1", expected: "7x6 5x5-2-1;7x6 5x5-2-1;" },
        { geometry: "60x1+1+1", expected: "7x6 6x5-1-1;7x6 6x5-1-1;" },
        { geometry: "60x1+%[fx:n]+1", expected: "7x6 7x5+0-1;7x6 7x5+0-1;" },
        { geometry: "60x1+%[fx:u[1].w]+1", expected: "7x6 8x5+1-1;7x6 8x5+1-1;" }
    ])(`expands shadow geometry $geometry using each frame index (${mode})`, async ({ geometry, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:#40608080", "-duplicate", "1", "-shadow", geometry,
            "-format", "%wx%h %g;", "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        // Native ImageMagick 7.1.2-35: offsets change the page, not the raster size.
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
