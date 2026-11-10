import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI uses the shaved raster for both
// page dimensions when either original page dimension is zero.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { page: "0x9-1+0", shave: "1x1", flatten: false, expected: "3x2:3x2-1+0" },
        { page: "0x9-1+0", shave: "1x1", flatten: true, expected: "3x2" },
        { page: "8x0-2-3", shave: "2x0", flatten: false, expected: "1x4:1x4-2-3" },
        { page: "8x9-2-3", shave: "2x0", flatten: false, expected: "1x4:4x9-2-3" },
    ])(`shaves page $page with $shave, flatten=$flatten (${mode})`, async ({ page, shave, flatten, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "5x4", "xc:red", "-repage", page, "-shave", shave,
            ...(flatten ? ["-background", "black", "-flatten"] : []),
            "-format", flatten ? "%wx%h" : "%wx%h:%g", "info:-"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
