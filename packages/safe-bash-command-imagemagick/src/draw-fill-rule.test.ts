import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const clockwise = "M1,1H7V7H1ZM3,3H5V5H3Z";
const reversed = "M1,1H7V7H1ZM3,3V5H5V3Z";
// Native ImageMagick 7.1.2-35 Q16-HDRI: complete 9x9, 8-bit gray rasters.
const hole = "e2dd02de53e4dc9e0fb83ff51caf554a63071f073ddb2ec37e30e53b63a942a7";
const solid = "0d3180608d39dd2d857de70c0abb61d5df4b2d64ffef965965f108994526151e";

for (const mode of ["map", "command"] as const) {
    it.each([
        { draw: `fill-rule evenodd path '${clockwise}'`, hash: hole },
        { draw: `fill-rule nonzero path '${clockwise}'`, hash: solid },
        { draw: `fill-rule nonzero path '${reversed}'`, hash: hole },
        { draw: `path '${clockwise}'`, hash: hole },
        { draw: "fill-rule nonzero path 'M1,1V7H7V1ZM3,3V5H5V3Z'", hash: solid },
        { draw: "fill-rule nonzero path 'M1,1H7V7H1M3,3H5V5H3'", hash: solid },
        { draw: `fill-rule nonzero push graphic-context fill-rule evenodd pop graphic-context path '${clockwise}'`, hash: solid },
        { draw: `push graphic-context fill-rule nonzero pop graphic-context path '${clockwise}'`, hash: hole },
    ])(`${mode}: native fill raster for $draw`, async ({ draw, hash }) => {
        const args = ["-size", "9x9", "xc:white", "-fill", "black", "-stroke", "none", "-draw", draw, "-depth", "8", "gray:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const mapResult = mode === "map" ? await runConvertCli(args, new Map()) : undefined;
        const result = mapResult ?? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async bytes => { chunks.push(bytes.slice()); } },
            stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode, mapResult?.stderr ?? stderr).toBe(0);
        expect(mapResult?.stderr ?? stderr).toBe("");
        const output = mapResult?.stdoutBytes ?? Buffer.concat(chunks);
        expect(output).toHaveLength(81);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}

for (const rule of ["", "invalid", "nonzero fill-rule"]) {
    it(`rejects invalid fill-rule '${rule}' without replacing the output`, async () => {
        const fs = new MemoryFileSystem(), original = new TextEncoder().encode("keep");
        await fs.writeFile("/out.gray", original);
        let stderr = "";
        const args = ["-size", "9x9", "xc:white", "-draw", `point 0,0 fill-rule ${rule}`, "-depth", "8", "/out.gray"];
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("fill-rule");
        expect(await fs.readFile("/out.gray")).toEqual(original);
    });
}
