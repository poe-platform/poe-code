import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick dilation of a centered white point on black.
const cases = [
    ["Ring:1,2", "..#../.#.#./#...#/.#.#./..#.."],
    ["Ring:2,3", "...#.../.##.##./.#...#./#.....#/.#...#./.##.##./...#..."],
    ["Ring:3,2", "...#.../.##.##./.#...#./#.....#/.#...#./.##.##./...#..."],
    ["Ring:0,2", "..#../.###./##.##/.###./..#.."],
    ["Ring:1", ".#./#.#/.#."],
    ["Ring", "..###../.#...#./#.....#/#.....#/#.....#/.#...#./..###.."]
];

it.each(cases.flatMap(([kernel, grid]) => ["buffered", "retained", "command"].flatMap(mode => ["Dilate", "Erode"].map(method => ({ kernel: kernel!, grid: grid!, mode, method })))))(
    "matches native $kernel pixels ($mode, $method)", async ({ kernel, grid, mode, method }) => {
        const size = grid.split("/").length;
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = [
            "-size", `${size}x${size}`, method === "Dilate" ? "xc:black" : "xc:white", "-fill", method === "Dilate" ? "white" : "black", "-draw", `point ${Math.floor(size / 2)},${Math.floor(size / 2)}`,
            "-morphology", method, kernel, "out.png"
        ];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode !== "buffered" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([size, size]);
        expect([...output.data]).toEqual([...grid.split("/").join("")].flatMap(pixel =>
            (pixel === "#") === (method === "Dilate") ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    }
);
