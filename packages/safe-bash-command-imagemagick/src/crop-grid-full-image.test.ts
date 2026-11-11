import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
// Native ImageMagick stops subdivision once a tile covers the entire raster.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["+append", ["-gravity", "East"], "2x1-1+0@", "4x1:+0,+0;", [0, 1, 2, 3]],
        ["+append", ["-gravity", "East"], "2x1@", "3x1:+0,+0;3x1:+1,+0;", [0, 1, 2, 1, 2, 3]],
        ["+append", [], "2x1-1+0@", "1x1:+1,+0;1x1:+3,+0;", [1, 3]],
        ["-append", ["-gravity", "South"], "1x2+0-1@", "1x4:+0,+0;", [0, 1, 2, 3]],
    ] as const)(`stops full-image grid crops and preserves partial tiles (${mode}): %s %j %s`, async (append, gravity, geometry, metadata, indices) => {
        for (const output of ["info", "rgb"] as const) {
            const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", append, "+repage", ...gravity,
                "-crop", geometry, ...(output === "info" ? ["-format", "%wx%h:%X,%Y;", "info:"] : ["-depth", "8", "rgb:/out.rgb"])];
            const filesystem = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (output === "info") expect("stdout" in result ? result.stdout : stdout).toBe(metadata);
            else expect(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb"))
                .toEqual(Uint8Array.from(indices.flatMap(index => pixels[index]!)));
        }
    });
}
