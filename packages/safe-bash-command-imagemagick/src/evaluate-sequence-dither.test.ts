import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI sequence references and DitherX/DitherY
// boundary cases: wider canvases distinguish Dither from Tile.
for (const mode of ["map", "retained", "sync", "command"] as const) {
    it.each([
        ["Dither", "4x1", "2x1", "11cc11cc"],
        ["Dither", "5x1", "2x1", "11cc11cc11"],
        ["Dither", "6x1", "2x1", "11cc11cc11cc"],
        ["Tile", "5x1", "2x1", "11cc11cc11"],
        ["Edge", "5x1", "2x1", "11cccccccc"],
        ["Dither", "36x1", "2x1", "11cc".repeat(11) + "cccc" + "11cccccc".repeat(3)],
        ["Dither", "1x6", "1x2", "11cc11cc11cc"],
        ["Dither", "6x2", "2x1", "11cc11cc11cc".repeat(2)],
        ["Dither", "4x2", "4x1", "0055aaff00ff00ff", "#000000-#ffffff"],
    ])(`${mode}: evaluates %s pixels from %s and %s`, async (method, canvas, source, expected, colors = "#111111-#cccccc") => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        const args = ["-virtual-pixel", method!, "-size", canvas!, "xc:black", "-size", source!,
            `gradient:${colors}`, "-evaluate-sequence", "Max", "-depth", "8", "gray:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
