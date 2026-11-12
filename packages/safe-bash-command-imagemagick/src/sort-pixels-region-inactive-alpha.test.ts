import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { alpha: "Discrete", operations: ["-region", "1x1+1+0", "-sort-pixels", "+region"], expected: "800020ffff0000ff" },
    { alpha: "Deactivate", operations: ["-region", "1x1+1+0", "-sort-pixels", "+region"], expected: "800020ffff0000ff" },
    { alpha: "On", operations: ["-region", "1x1+1+0", "-sort-pixels", "+region"], expected: "80002080ff000080" },
    { alpha: "Off", operations: ["-region", "1x1+1+0", "-sort-pixels", "+region"], expected: "ff0000ffff0000ff" },
    { alpha: "Discrete", operations: ["-sort-pixels"], expected: "0000ffffff0000ff" },
    { alpha: "Discrete", operations: ["-region", "1x1+1+0", "+region"], expected: "ff0000ff0000ffff" },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: sorts retained $alpha alpha with $operations`, async ({ alpha, operations, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["xc:#ff000080", "xc:#0000ff40", "+append", "-alpha", alpha, ...operations, "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
