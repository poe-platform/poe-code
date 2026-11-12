import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const setting of ["define", "option", "artifact"] as const) {
        it.each([
            ["8x6/2", 1, 1, 5, 4],
            ["8/2x6", 1, 1, 5, 4],
            ["8x6/", 1, 1, 5, 4],
            ["8x6", 8, 6, 2, 2],
            ["8x6junk", 1, 1, 5, 4],
            [undefined, 1, 1, 5, 4],
        ] as const)(`matches native trim minimum %s (${mode}, ${setting})`, async (size, width, height, left, top) => {
            // ImageMagick 7.1.2-35 Q16-HDRI ignores the whole minimum when it contains a slash.
            const options = size === undefined ? [] : setting === "define" ? ["-define", `trim:minSize=${size}`]
                : ["-set", `${setting}:trim:minSize`, size];
            const argv = ["-size", "11x9", "xc:white", "-fill", "red", "-draw", "point 5,4", "-gravity", "Center",
                ...options, "-trim", "-depth", "8", "-write", "rgb:/pixels", "-format", "%wx%h|%g", "info:/geometry"];
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const geometry = mode === "command" || mode === "retained" ? await fs.readFile("/geometry") : files.get("/geometry")!;
            expect(new TextDecoder().decode(geometry)).toBe(`${width}x${height}|11x9+${left}+${top}`);
            const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
            const expected = [];
            for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
                expected.push(...(x === 5 && y === 4 ? [255, 0, 0] : [255, 255, 255]));
            }
            expect(pixels).toEqual(new Uint8Array(expected));
        });
    }
}
