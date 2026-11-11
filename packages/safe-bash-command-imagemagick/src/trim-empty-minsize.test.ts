import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI expands minimum bounds before checking the raster.
for (const mode of ["command", "retained", "map", "sync"] as const) {
    it.each([
        { edges: "west,north", minimum: "4x4", geometry: "4x4|6x5+2+1", pixels: 16 },
        { edges: "west", minimum: "4x4", geometry: "4x5|6x5+2+0", pixels: 20 },
        { edges: "north", minimum: "4x4", geometry: "6x4|6x5+0+1", pixels: 24 },
        { edges: "west,north", minimum: "4", geometry: "4x1|6x5+2+4", pixels: 4 },
        { edges: "west,north", minimum: "x4", geometry: "1x4|6x5+5+1", pixels: 4 },
        { edges: "west,north", minimum: "20x20", geometry: "6x5|6x5+0+0", pixels: 30 },
        { edges: "west,north", minimum: "1x1", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "west,north", minimum: "0x0", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "west", minimum: "x4", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "north", minimum: "4", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "west,north", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "west", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "north", geometry: "6x5|6x5+0+0", pixels: 30, warning: true },
        { edges: "east", minimum: "4x4", geometry: "1x1|6x5-1-1", pixels: 1, warning: true, empty: true },
        { edges: "south", minimum: "4x4", geometry: "1x1|6x5-1-1", pixels: 1, warning: true, empty: true },
        { edges: "west,north", minimum: "4x4", page: "11x9+3+4", geometry: "4x4|6x5+5+5", pixels: 16 },
    ])(`${mode}: trims uniform $edges with minimum=$minimum, page=$page`, async ({ edges, minimum, page, geometry, pixels, warning, empty }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "6x5", "xc:white", ...(page ? ["-repage", page] : []),
            "-define", `trim:edges=${edges}`, ...(minimum ? ["-define", `trim:minSize=${minimum}`] : []),
            "-trim", "-depth", "8", "-write", "rgba:/pixels", "-format", "%wx%h|%g", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        expect(result.exitCode, stderr).toBe(0);
        expect(stdout).toBe(geometry);
        expect(stderr).toBe(warning ? "magick: geometry does not contain image\n" : "");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        expect(output).toEqual(empty ? new Uint8Array([255, 255, 255, 0]) : new Uint8Array(pixels * 4).fill(255));
    });
}
