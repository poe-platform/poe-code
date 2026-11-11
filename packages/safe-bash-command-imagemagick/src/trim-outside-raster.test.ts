import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps the original raster when selected-edge
// bounds exist but begin beyond the last pixel, while still warning on -trim.
for (const mode of ["command", "retained", "map", "sync"] as const) {
    it.each([
        { edges: "north", geometry: "3x3|3x3+0+0|True" },
        { edges: "west", geometry: "3x3|3x3+0+0|True" },
        { edges: "north,west", geometry: "3x3|3x3+0+0|True" },
        { edges: "north", page: "7x8+2+4", geometry: "3x3|7x8+2+4|True" },
        { edges: "west", page: "7x8-2-4", geometry: "3x3|7x8-2-4|True" },
        { edges: "north", trim: false, geometry: "3x3|3x3+0+0|True" },
        { edges: "north", trim: false, format: "%@|%[bounding-box]", geometry: "4x1+0+3|0,3 4,4" },
        { edges: "north", draw: true, geometry: "3x2|3x3+0+1|True" },
        { edges: undefined, geometry: "1x1|3x3-1-1|False" },
    ])(`${mode}: trims $edges with page=$page, trim=$trim, draw=$draw, format=$format`, async ({ edges, page, trim = true, draw = false, format = "%wx%h|%g|%[opaque]", geometry }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "3x3", "xc:white", ...(page ? ["-repage", page] : []),
            ...(draw ? ["-fill", "black", "-draw", "point 1,1"] : []),
            ...(edges ? ["-define", `trim:edges=${edges}`] : []), ...(trim ? ["-trim"] : []),
            "-depth", "8", "-write", "rgba:/pixels", "-format", format, "info:/geometry"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe(trim && !draw ? "magick: geometry does not contain image 'white'\n" : "");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/geometry") : files.get("/geometry")!;
        expect(new TextDecoder().decode(output)).toBe(geometry);
        const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
        expect(Buffer.from(pixels).toString("hex")).toBe(edges === undefined ? "ffffff00"
            : draw ? "ffffffff000000ff" + "ffffffff".repeat(4) : "ffffffff".repeat(9));
    });
}
