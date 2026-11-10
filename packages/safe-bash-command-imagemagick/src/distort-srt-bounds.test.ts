import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI geometry for a solid 3x2 image.
for (const mode of ["command", "sync"] as const) {
    it.each([
        ["+distort", "90", "3x4|3x4+0-1"],
        ["-distort", "90", "3x2|3x2+0+0"],
        ["+distort", "2,1,90", "4x5|4x5+0-2"],
        ["+distort", "0", "5x4|5x4-1-1"],
    ])(`${mode}: preserves SRT bounds for %s %s`, async (operator, rotation, geometry) => {
        const args = ["-size", "3x2", "xc:red", "-filter", "point", "-virtual-pixel", "tile", operator!, "SRT", rotation!, "-format", "%wx%h|%g", "info:-"];
        let stdout = "", stderr = "";
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = runMagickCliSync(args, new Map());
            ({ exitCode, stdout, stderr } = result);
        }
        expect(exitCode, stderr).toBe(0);
        expect(stdout).toBe(geometry);
    });
}
