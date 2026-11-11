import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI leaves empty far-edge bounds unexpanded.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    for (const size of ["3x3", "1x3", "3x1", "1x1"]) {
        for (const edges of ["east", "south", "east,south"]) {
            it.each([false, true])(`${mode} preserves empty ${edges} bounds for ${size} (trim=%s)`, async (trim) => {
                const [width, height] = size.split("x").map(Number);
                const boundsWidth = edges.includes("east") ? 0 : width!;
                const boundsHeight = edges.includes("south") ? 0 : height!;
                const args = ["-size", size, "xc:white", "-define", `trim:edges=${edges}`,
                    ...(trim ? ["-trim"] : []), "-format", trim ? "%wx%h|%g|%[opaque]" : "%@|%[bounding-box]", "info:"];
                const fs = new MemoryFileSystem();
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
                } else result = mode === "sync" ? runMagickCliSync(args, new Map())
                    : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
                expect(result).toEqual({
                    exitCode: 0,
                    stdout: trim ? `1x1|${size}-1-1|False` : `${boundsWidth}x${boundsHeight}+0+0|0,0 ${boundsWidth},${boundsHeight}`,
                    stderr: trim ? "magick: geometry does not contain image 'white'\n" : "magick: geometry does not contain image\n"
                });
            });
        }
    }
}

it.each([
    ["east", "2x4+0+0|0,0 2,4", "2x3|3x3+0+0|True"],
    ["south", "4x2+0+0|0,0 4,2", "3x2|3x3+0+0|True"],
    ["east,south", "2x2+0+0|0,0 2,2", "2x2|3x3+0+0|True"],
])("preserves nonempty %s bounds and crops", async (edges, bounds, crop) => {
    for (const trim of [false, true]) {
        const result = await runMagickCli(["-size", "3x3", "xc:white", "-fill", "black", "-draw", "point 1,1",
            "-define", `trim:edges=${edges}`, ...(trim ? ["-trim"] : []),
            "-format", trim ? "%wx%h|%g|%[opaque]" : "%@|%[bounding-box]", "info:"], new Map());
        expect(result).toEqual({ exitCode: 0, stdout: trim ? crop : bounds, stderr: "" });
    }
});

it.each([
    [[], 0, "magick: geometry does not contain image\n"],
    [["-quiet"], 0, ""],
    [["-regard-warnings"], 1, "magick: geometry does not contain image\n"]
] as const)("honors empty-bound warning options %j", async (options, exitCode, stderr) => {
    const result = await runMagickCli([...options, "-size", "3x3", "xc:white", "-define", "trim:edges=east",
        "-format", "%@|%[bounding-box]", "info:"], new Map());
    expect(result).toEqual({ exitCode, stdout: "0x3+0+0|0,0 0,3", stderr });
});
