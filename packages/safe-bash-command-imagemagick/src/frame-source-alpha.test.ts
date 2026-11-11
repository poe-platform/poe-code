import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Off activates the translucent matte;
// Deactivate and Discrete retain source blending but keep output alpha inactive.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const activate of [false, true]) it.each([
        { alpha: undefined, corner: "2880b070", source: "cd7c97ff" },
        { alpha: "opaque", corner: "2880b070", source: "c03060ff" },
        { alpha: "off", corner: "2880b070", source: "c03060ff" },
        { alpha: "deactivate", corner: "2880b0ff", source: "cd7c97ff" },
        { alpha: "discrete", corner: "2880b0ff", source: "cd7c97ff" },
    ])(`${mode}: frames source alpha $alpha with a translucent matte (activate=${activate})`, async ({ alpha, corner, source }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "3x2", "xc:#c0306090", "-mattecolor", "#2880b070",
            ...(alpha ? ["-alpha", alpha] : []), "-compose", "Over", "-frame", "3x3+0+0", ...(activate ? ["-alpha", "activate"] : []), "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        const expected = Array.from({ length: 9 * 8 }, (_, pixel) => {
            const x = pixel % 9, y = Math.floor(pixel / 9);
            return x >= 3 && x < 6 && y >= 3 && y < 5 ? source : activate ? "2880b070" : corner;
        }).join("");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
