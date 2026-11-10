import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI page geometry references.
const viewport = ["-define", "distort:viewport=2x1+1+1"];
const solid = ["-size", "3x2", "xc:red"];
const grid = ["xc:#102030", "xc:#405060", "xc:#708090", "+append", "(",
    "xc:#8090a0", "xc:#9090a0", "xc:#a090a0", "+append", ")", "-append", "+repage"];

for (const mode of ["public", "sync"] as const) {
    it.each([
        { name: "repaged viewport", input: [...solid, "-repage", "8x7+2+1", ...viewport], expected: "2x1|5x4+1+1" },
        { name: "reset page viewport", input: [...grid, ...viewport], expected: "2x1|0x0+1+1" },
        { name: "ordinary viewport", input: [...solid, ...viewport], expected: "2x1|2x1+1+1" },
        { name: "repage without viewport", input: [...solid, "-repage", "8x7+2+1"], expected: "3x2|8x7+0+0" }
    ])(`preserves native $name geometry (${mode})`, async ({ input, expected }) => {
        const args = [...input, "-filter", "point", "-distort", "SRT", "0", "-format", "%wx%h|%g", "info:-"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, new Map()) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        if ("stdout" in result) stdout += result.stdout;
        if ("stderr" in result) stderr += result.stderr;
        expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
