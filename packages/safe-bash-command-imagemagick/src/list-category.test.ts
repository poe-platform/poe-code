import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, excluding its installation-specific preamble.
const thresholds = `Map              Alias        Description
----------------------------------------------------
threshold        1x1          Threshold 1x1 (non-dither)
checks           2x1          Checkerboard 2x1 (dither)
o2x2             2x2          Ordered 2x2 (dispersed)
o3x3             3x3          Ordered 3x3 (dispersed)
o4x4             4x4          Ordered 4x4 (dispersed)
o8x8             8x8          Ordered 8x8 (dispersed)
h4x4a            4x1          Halftone 4x4 (angled)
h6x6a            6x1          Halftone 6x6 (angled)
h8x8a            8x1          Halftone 8x8 (angled)
h4x4o                         Halftone 4x4 (orthogonal)
h6x6o                         Halftone 6x6 (orthogonal)
h8x8o                         Halftone 8x8 (orthogonal)
h16x16o                       Halftone 16x16 (orthogonal)
c5x5b            c5x5         Circles 5x5 (black)
c5x5w                         Circles 5x5 (white)
c6x6b            c6x6         Circles 6x6 (black)
c6x6w                         Circles 6x6 (white)
c7x7b            c7x7         Circles 7x7 (black)
c7x7w                         Circles 7x7 (white)
`;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ...["Threshold", "threshold", "tHrEsHoLd"].map(category => ({ category, exitCode: 0, stdout: thresholds, stderr: "" })),
        { category: "Thresholds", exitCode: 1, stdout: "", stderr: "magick: unrecognized list type '-list' 'Thresholds'\n" },
        { category: "NotAListName", exitCode: 1, stdout: "", stderr: "magick: unrecognized list type '-list' 'NotAListName'\n" },
        { category: "Metric", exitCode: 0, stdout: "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n", stderr: "" },
        { category: "List", exitCode: 0, stdout: "color\nconfigure\ndelegate\nfont\nformat\nlocale\nlog\nmagic\nmodule\nresource\nthreshold\ntype\n", stderr: "" }
    ])(`${mode} handles -list $category without image input`, async ({ category, ...expected }) => {
        const args = ["-list", category];
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        if (mode === "command") {
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            expect({ exitCode: result.exitCode, stdout, stderr }).toEqual(expected);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual(expected);
        }
        expect(files.size).toBe(0);
        expect(await filesystem.readdir("/")).toEqual([]);
    });
}
