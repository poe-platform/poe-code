import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Array.from({ length: 18 }, (_, i) => i + 10);
// Native ImageMagick 7: aspect-ratio crops with defined gravity select one frame.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        [["-gravity", "East"], "1:1", "2x2:3x2+1+0;", [1, 2, 4, 5]],
        [["-gravity", "NorthWest"], "1:1", "2x2:3x2+0+0;", [0, 1, 3, 4]],
        [["-gravity", "Center"], "1:1", "2x2:3x2+0+0;", [0, 1, 3, 4]],
        [[], "1:1", "2x2:3x2+0+0;1x2:3x2+2+0;", [0, 1, 3, 4, 2, 5]],
        [["-gravity", "East", "+gravity"], "1:1", "2x2:3x2+0+0;1x2:3x2+2+0;", [0, 1, 3, 4, 2, 5]],
        [["-gravity", "None"], "1:1", "2x2:3x2+0+0;1x2:3x2+2+0;", [0, 1, 3, 4, 2, 5]],
        [["-gravity", "East"], "1:1+0+0", "2x2:3x2+1+0;", [1, 2, 4, 5]],
        [["-gravity", "East"], "2x2", "2x2:3x2+0+0;1x2:3x2+2+0;", [0, 1, 3, 4, 2, 5]],
    ] as const)(`positions aspect crops (${mode}): %j %s`, async (gravity, geometry, metadata, indices) => {
        for (const output of ["info", "rgb"] as const) {
            const args = ["/input.ppm", ...gravity, "-crop", geometry,
                ...(output === "info" ? ["-format", "%wx%h:%g;", "info:"] : ["-depth", "8", "rgb:/out.rgb"])];
            const filesystem = new MemoryFileSystem();
            const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"), ...pixels]);
            const files = new Map([["/input.ppm", input]]);
            await filesystem.writeFile("/input.ppm", input);
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
                .toEqual(Uint8Array.from(indices.flatMap(index => pixels.slice(index * 3, index * 3 + 3))));
        }
    });
}
