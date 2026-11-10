import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const cases = [
    {
        name: "sorts a translucent rectangular region",
        operations: ["-region", "2x1+1+0", "-sort-pixels"],
        expected: "983058809c246c802070b0ff20a040ff09126c80603020ff72244280630f2180"
    },
    {
        name: "carries the rectangular selection to subsequent edits",
        operations: ["-alpha", "opaque", "-region", "2x1+1+0", "-sort-pixels", "-negate", "+region"],
        expected: "2fcf6f00d03090ffdf8f4f0020a040ff1020c0ff603020ffd03090ffa01010ff"
    },
    {
        name: "sorts an opaque rectangular region",
        operations: ["-alpha", "opaque", "-region", "2x1+1+0", "-sort-pixels"],
        expected: "d03090ffd03090ff2070b0ff20a040ff1020c0ff603020ffd03090ffa01010ff"
    },
    {
        name: "sorts without a region",
        operations: ["-sort-pixels"],
        expected: "603020ffd03090802070b0ff20a040ff1020c080a0101080603020ffd0309080"
    }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI reference outputs, including stable intensity ties.
    it.each(cases)(`${mode}: $name`, async ({ operations, expected }) => {
        const files = new Map([
            ["in.raw", Buffer.from("d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080", "hex")],
            ["out", new TextEncoder().encode("KEEP")]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["-size", "4x2", "-depth", "8", "rgba:in.raw", ...operations, "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
