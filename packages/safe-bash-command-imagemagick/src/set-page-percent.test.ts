import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick treats page percentages as literal dimensions.
for (const mode of ["sync", "public"] as const) {
    for (const flatten of [false, true]) {
        it.each([
            ["25%", 25],
            ["25x25", 25],
            ["25", 3],
        ] as const)(`sets page %s with flatten=${flatten} via ${mode}`, async (geometry, height) => {
            const argv = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", "-set", "page", geometry,
                ...(flatten ? ["-background", "black", "-flatten"] : []), "-format", "%wx%h|%g;", "info:"];
            let stdout = "", stderr = "", exitCode: number;
            if (mode === "public") {
                const argumentValues = createCommandArguments(argv);
                ({ exitCode } = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
                    fs: new MemoryFileSystem(), signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }));
            } else {
                ({ exitCode, stdout, stderr } = runConvertCliSync(argv, new Map()));
            }
            expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            expect(stdout).toBe(flatten ? `25x${height}|25x${height}+0+0;` : `3x2|25x${height}+1+1;`);
        });
    }
}
