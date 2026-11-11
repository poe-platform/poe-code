import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors: Record<string, number[]> = { ".": [255, 255, 255, 255], R: [255, 0, 0, 255], B: [0, 0, 255, 255] };

// ImageMagick 7.1.2-35 Q16-HDRI: dimensions and decoded PNG32 RGBA8 pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operation: "+smush", method: undefined, before: false, rows: [".....", "...R.", ".....", "....B"] },
        { operation: "-smush", method: undefined, before: false, rows: ["....", "...R", ".B.."] },
        { operation: "+smush", method: "Transparent", before: false, rows: ["....", "...R", "....", "...B"] },
        { operation: "+smush", method: "Transparent", before: true, rows: ["....", "...R", "....", "...B"] },
        { operation: "-smush", method: "Black", before: false, rows: ["....", "...R", "....", "....", "....", ".B.."] },
        { operation: "-smush", method: "Black", before: true, rows: ["....", "...R", "....", "....", "....", ".B.."] },
    ])(`${mode} $operation uses the shorter input's $method virtual pixels (before input: $before)`, async ({ operation, method, before, rows }) => {
        const setting = method ? ["-virtual-pixel", method] : [];
        const left = operation === "+smush" ? setting : [], right = operation === "-smush" ? setting : [];
        const argv = ["-respect-parentheses",
            "(", ...(before ? left : []), "-size", "4x2", "xc:none", "-fill", "red", "-draw", "point 3,1", ...(!before ? left : []), ")",
            "(", ...(before ? right : []), "-size", "2x4", "xc:none", "-fill", "blue", "-draw", "point 1,3", ...(!before ? right : []), ")",
            operation, "0", "PNG32:/out.png"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const actual = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([actual.width, actual.height]).toEqual([rows[0]!.length, rows.length]);
        expect([...actual.data]).toEqual(rows.flatMap(row => [...row].flatMap(pixel => colors[pixel]!)));
    });
}
