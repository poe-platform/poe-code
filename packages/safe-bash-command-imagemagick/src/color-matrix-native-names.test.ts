import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA16 big-endian output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { matrix: "DoG:1,1,2", expected: "0e901e290e9070701a6a37051a6acfcf" },
        { matrix: "LoG:1x1", expected: "08882b88088870700e4f4db80e4fcfcf" },
        { matrix: "Comet:2x1", expected: "23733e3e595970709d4e68682929cfcf" },
        { matrix: "Binomial:1", expected: "ececffffecec7070ffffffffffffcfcf" },
        { matrix: "FreiChen", expected: "00000000000070708c8cc6c38c8ccfcf" },
        { matrix: "Roberts", expected: "000000000000707000004d4d0000cfcf" },
        { matrix: "Prewitt", expected: "00000000000070708c8c8c8c8c8ccfcf" },
        { matrix: "Compass", expected: "0000000000007070f4f40000f4f4cfcf" },
        { matrix: "Kirsch", expected: "0000000000007070ffffffffffffcfcf" },
        { matrix: "Ring:1,2", expected: "00000000000000000000000000000000" },
        { matrix: "Plus:1", expected: "0000aeae000070700000ffff0000cfcf" },
        { matrix: "Cross:1", expected: "0000000000007070000000000000cfcf" },
        { matrix: "Peaks", expected: "00000000000000000000000000000000" },
        { matrix: "Edges", expected: "0000000000007070000000000000cfcf" },
        { matrix: "Corners", expected: "0000000000007070000000000000cfcf" },
        { matrix: "Diagonals", expected: "0000000000007070000000000000cfcf" },
        { matrix: "LineEnds", expected: "0000979700007070000091910000cfcf" },
        { matrix: "LineJunctions", expected: "0000000000007070000000000000cfcf" },
        { matrix: "Ridges", expected: "3e3e3e3e59597070686868682929cfcf" },
        { matrix: "ConvexHull", expected: "0000000000007070000000000000cfcf" },
        { matrix: "ThinSe", expected: "0000000000007070000000000000cfcf" },
        { matrix: "Skeleton", expected: "0000000000007070000000000000cfcf" },
        { matrix: "Chebyshev", expected: "ffffffffffff7070ffffffffffffcfcf" },
        { matrix: "Manhattan", expected: "ffffffffffff7070ffffffffffffcfcf" },
        { matrix: "Octagonal", expected: "ffffffffffffffffffffffffffffffff" },
        { matrix: "Euclidean", expected: "ffffffffffff7070ffffffffffffcfcf" },
        { matrix: "Unity", expected: "17173e3e59597070b5b568682929cfcf" },
        { matrix: "Sobel", expected: "00000000000070708c8cffff8c8ccfcf" },
        { matrix: "Square:1", expected: "aeaeaeaeaeae7070ffffffffffffcfcf" },
        { matrix: "DoG", expected: "0000000000007070000000000000cfcf" },
        { matrix: "DoG:2,0.8,1.5", expected: "00000365238f00000000000003f10000" },
        { matrix: "DoG:0,1,2", expected: "00000000000000000000000000000000" },
        { matrix: "LoG", expected: "00003e3e00007070000068680000cfcf" },
        { matrix: "LoG:2x1", expected: "000002b0266600000000000002b70000" },
        { matrix: "LoG:0x1", expected: "0000000000004f4e0000000000007c70" },
        { matrix: "Comet", expected: "17173e3e59597070b5b568682929cfcf" },
        { matrix: "Comet:3x1", expected: "265e3e3e59597070970568682929cfcf" },
        { matrix: "Comet:3x1+90", expected: "0ef245235a997070759e9ea932fecfcf" },
        { matrix: "Comet:3x1+180", expected: "4dab3e3e5959707043a668682929cfcf" },
        { matrix: "Comet:3x1+270", expected: "01404523684b707009d59ea99ec7cfcf" },
        { matrix: "Binomial:2", expected: "ffffffffffffffffffffffffffffffff" },
        { matrix: "Plus", expected: "00000000ffff000000000000ffff0000" },
        { matrix: "Plus:2,0.5", expected: "000000008f8f000000000000ffff0000" },
        { matrix: "Cross", expected: "00000000000000000000000000000000" },
        { matrix: "Cross:2,0.5", expected: "00000000000000000000000000000000" },
        { matrix: "Ring", expected: "00000000000000000000000000000000" },
        { matrix: "Ring:2,1,0", expected: "00000000000000000000000000000000" },
        { matrix: "Peaks:1,2", expected: "00000000000000000000000000000000" },
        { matrix: "Chebyshev:1x0.01", expected: "01bf012001bf70700346023b0346cfcf" },
        { matrix: "Manhattan:2x0.01", expected: "091306340355091313890e2f08d61389" },
        { matrix: "Octagonal:2x0.01", expected: "071904d9035507190e990a4a08d60e99" },
        { matrix: "Euclidean:1x0.01", expected: "02360120023670700432023b0432cfcf" },
        { matrix: "Euclidean:2x0.01", expected: "070304ce035507030e2d0a9908d60e2d" },
        { matrix: "cOmPaSs", expected: "0000000000007070f4f40000f4f4cfcf" },
        { matrix: "Prewitt;Ring:1,2", expected: "00000000000070708c8c8c8c8c8ccfcf" },
    ])(`${mode}: resolves the native $matrix kernel before numeric coefficients`, async ({ matrix, expected }) => {
        const argv = ["xc:#173e5970", "xc:#b56829cf", "+append", "-color-matrix", matrix, "-depth", "16", "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(expected);
        expect(result.stderr).toBe("");
    });
}
