import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync, type ImageMagickCliResult } from "./index.js";

const greenEdit = ["-channel", "Green", "-evaluate", "set", "0", "+channel"];
const rgba = ["-depth", "16", "-endian", "MSB", "rgba:-"];
const info = ["-format", "%[colorspace]|%[channels]", "info:"];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { operator: "-level-colors", colors: "black,white", output: [...greenEdit, ...rgba], expected: "666600006666ffff" },
        { operator: "-level-colors", colors: "black,white", output: info, expected: "sRGB|srgb  3.0" },
        { operator: "+level-colors", colors: "black,white", output: info, expected: "sRGB|srgb  3.0" },
        { operator: "-level-colors", colors: "#333,#bbb", output: info, expected: "sRGB|srgb  3.0" },
        { operator: "-level-colors", colors: "gray30,white", output: info, expected: "sRGB|srgb  3.0" },
        { operator: "-level-colors", colors: "black,white", output: rgba, expected: "666666666666ffff" },
        { operator: "-level-colors", colors: "gray30,gray70", output: info, expected: "Gray|gray  1.0" },
        { operator: "-level-colors", colors: "gray30,gray70", output: [...greenEdit, ...rgba], expected: "3ebf3ebf3ebfffff" },
        { operator: "-level-colors", colors: "red,blue", output: [...greenEdit, ...rgba], expected: "999900006666ffff" },
        { operator: "-level-colors", colors: "rgb(0,0,0),rgb(255,255,255)", output: info, expected: "sRGB|srgb  3.0" },
        { operator: "+level-colors", colors: "gray(30%),gray(70%)", output: info, expected: "Gray|gray  1.0" },
    ])(`${mode}: $operator $colors with $output matches native gray promotion`, async ({ operator, colors, output, expected }) => {
        const args = ["xc:gray40", operator, colors, ...output];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const binary = output.at(-1) === "rgba:-";
        const result: ImageMagickCliResult = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(binary ? "hex" : "utf8"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const actual = binary && mode !== "magick" && mode !== "convert"
            ? Buffer.from(result.stdoutBytes!).toString("hex") : result.stdout;
        expect(actual).toBe(expected);
    });
}
