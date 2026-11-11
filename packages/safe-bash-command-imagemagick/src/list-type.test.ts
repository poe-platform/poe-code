import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: magick -list Type / Metric.
const types = "Bilevel\nColorSeparation\nColorSeparationAlpha\nColorSeparationMatte\nGrayscale\nGrayscaleAlpha\nGrayscaleMatte\nOptimize\nPalette\nPaletteBilevelAlpha\nPaletteBilevelMatte\nPaletteAlpha\nPaletteMatte\nTrueColorAlpha\nTrueColorMatte\nTrueColor\n";
const metrics = "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { category: "Type", expected: types },
        { category: "type", expected: types },
        { category: "TYPE", expected: types },
        { category: "Metric", expected: metrics },
        { category: "Font", expected: expect.stringContaining("  Font: DejaVu-Sans\n    family: DejaVu Sans\n") }
    ])(`${mode}: lists $category on stdout without image inputs`, async ({ category, expected }) => {
        const args = ["-list", category];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toEqual(expected);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
    });
}
